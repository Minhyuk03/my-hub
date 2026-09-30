/**
 * 인덱서 워커: 웹 서버와 별도 프로세스로 실행된다.
 * - 소스 스캔(전체·하위 폴더), 변경 감지(chokidar/FSEvents), 주기적 재검사
 * - 외장 디스크 연결·분리 감지
 * - 실패 항목 재시도, DB 자동 백업
 * - 웹에서 넣은 명령(commands 테이블) 처리
 */
import fs from "node:fs";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { applyRetention, createBackup, flushPending, realBackupEnv } from "@/server/backup";
import { openDb } from "@/server/db";
import { backups, commands, runtime, scanJobs, sources } from "@/server/db/schema";
import { getSettings } from "@/server/settings";
import { checkAvailability } from "@/server/sources/availability";
import { refreshSuggestions } from "@/server/projects/suggest";
import { seedDefaultSources } from "@/server/sources/manage";
import { isExcludedFolder, isExcludedName, isInside } from "@/server/sources/rules";
import { processFile, realDeps, reindexItems, retryDue, runScan } from "@/server/sync/scanner";

const db = openDb();
let stopping = false;
const deps = { ...realDeps(), shouldAbort: () => stopping };
const log = (...a: unknown[]) => console.log(new Date().toLocaleString("ko-KR"), "[worker]", ...a);

type Task = { sourceId: number; scope?: string };
const queue: Task[] = [];
let current: Task | null = null;
const watchers = new Map<number, FSWatcher>();
const online = new Map<number, boolean>();

function setRuntime(key: string, value: unknown) {
  db.insert(runtime)
    .values({ key, value, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: runtime.key, set: { value, updatedAt: Date.now() } })
    .run();
}

function enqueueScan(t: Task) {
  // 같은 소스에서 이미 더 넓은 범위가 대기 중이면 생략
  const covered = (a: Task) => a.sourceId === t.sourceId && (!a.scope || (t.scope && isInside(t.scope, a.scope)));
  if (queue.some(covered) || (current && covered(current) && !t.scope)) return;
  queue.push(t);
}

async function runQueue() {
  if (current || !queue.length || stopping) return;
  current = queue.shift()!;
  const src = db.select().from(sources).where(eq(sources.id, current.sourceId)).get();
  if (src?.enabled) {
    log("스캔 시작", src.name, current.scope ?? "(전체)");
    const r = await runScan(db, src.id, deps, current.scope);
    log("스캔 종료", src.name, r.result, r.message ?? "", r.deleted ? `삭제 ${r.deleted}` : "");
    // 폴더 구성이 바뀌었을 수 있으므로 프로젝트 연결 제안을 다시 계산한다
    if (r.result === "ok" && !current.scope) updateSuggestions();
  }
  current = null;
}

// ---------- 변경 감지 ----------
const pendingDirs = new Map<string, NodeJS.Timeout>();
function scheduleSubtree(sourceId: number, dir: string) {
  const key = `${sourceId}:${dir}`;
  clearTimeout(pendingDirs.get(key));
  pendingDirs.set(
    key,
    setTimeout(() => {
      pendingDirs.delete(key);
      enqueueScan({ sourceId, scope: dir });
    }, 5000),
  );
}

function startWatcher(src: typeof sources.$inferSelect) {
  if (watchers.has(src.id)) return;
  const settings = getSettings(db);
  const nested = db
    .select({ rootPath: sources.rootPath })
    .from(sources)
    .all()
    .map((r) => r.rootPath)
    .filter((r) => r !== src.rootPath && isInside(r, src.rootPath));
  const w = chokidar.watch(src.rootPath, {
    ignoreInitial: true,
    followSymlinks: false,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 },
    ignored: (p: string) =>
      p !== src.rootPath && (isExcludedName(path.basename(p), settings.excludedPatterns) || isExcludedFolder(p, settings.excludedFolders) || nested.some((n) => isInside(p, n))),
  });
  const onFile = async (p: string) => {
    try {
      const st = fs.statSync(p);
      if (st.isFile()) await processFile(db, src, p, st, deps);
    } catch {
      // 곧바로 사라진 파일은 하위 폴더 확인에서 처리
    }
  };
  w.on("add", onFile)
    .on("change", onFile)
    .on("addDir", (p) => scheduleSubtree(src.id, p))
    // 삭제는 바로 반영하지 않고, 해당 폴더를 끝까지 다시 확인한 뒤 판단한다 (삭제 판단 규칙)
    .on("unlink", (p) => scheduleSubtree(src.id, path.dirname(p)))
    .on("unlinkDir", (p) => scheduleSubtree(src.id, path.dirname(p)))
    .on("error", (e) => log("감시 오류", src.name, String(e)));
  watchers.set(src.id, w);
}

async function stopWatcher(id: number) {
  await watchers.get(id)?.close();
  watchers.delete(id);
}

// ---------- 주기 작업 ----------
async function checkSources() {
  const settings = getSettings(db);
  for (const src of db.select().from(sources).where(eq(sources.enabled, true)).all()) {
    const a = checkAvailability(src, deps.mount);
    const was = online.get(src.id);
    online.set(src.id, a.ok);
    if (!a.ok) {
      if (was !== false) {
        log("소스 사용 불가", src.name, a.reason);
        await stopWatcher(src.id);
      }
      if (src.status !== a.status || src.lastError !== a.reason)
        db.update(sources).set({ status: a.status, lastError: a.reason }).where(eq(sources.id, src.id)).run();
      continue;
    }
    if (was !== true) {
      // 처음 시작했거나 디스크가 다시 연결됨
      startWatcher(src);
      if (src.status === "offline" || src.status === "error") db.update(sources).set({ status: "ok", lastError: null }).where(eq(sources.id, src.id)).run();
      enqueueScan({ sourceId: src.id });
      continue;
    }
    const due = !src.lastFullScanAt || Date.now() - src.lastFullScanAt > settings.fullScanIntervalHours * 3600_000;
    if (due) enqueueScan({ sourceId: src.id });
  }
}

async function handleCommands() {
  const list = db.select().from(commands).where(isNull(commands.takenAt)).all();
  for (const c of list) {
    db.update(commands).set({ takenAt: Date.now() }).where(eq(commands.id, c.id)).run();
    let result = "ok";
    try {
      const sourceId = Number(c.payload.sourceId);
      switch (c.kind) {
        case "rescan":
        case "source_added":
          online.delete(sourceId); // 다음 확인 때 감시 시작 + 전체 스캔
          await checkSources();
          if (c.kind === "rescan") enqueueScan({ sourceId });
          break;
        case "source_removed":
          await stopWatcher(sourceId);
          online.delete(sourceId);
          break;
        case "retry":
          await retryDue(db, deps, (c.payload.itemIds as number[] | undefined) ?? undefined);
          break;
        case "reindex":
          await reindexItems(db, deps, c.payload.itemIds as number[]);
          break;
        case "refresh_suggestions":
          updateSuggestions();
          break;
        case "backup":
          result = doBackup();
          break;
        case "settings_changed":
          for (const id of [...watchers.keys()]) {
            await stopWatcher(id);
            online.delete(id);
          }
          await checkSources();
          break;
        default:
          result = "알 수 없는 명령";
      }
    } catch (e) {
      result = `오류: ${(e as Error).message}`;
    }
    db.update(commands).set({ doneAt: Date.now(), result }).where(eq(commands.id, c.id)).run();
  }
  // 오래된 명령 기록 정리
  db.delete(commands).where(sql`${commands.doneAt} < ${Date.now() - 7 * 86400_000}`).run();
}

function updateSuggestions() {
  try {
    const n = refreshSuggestions(db);
    if (n) log("프로젝트 연결 제안", `${n}건`);
  } catch (e) {
    log("제안 계산 실패", (e as Error).message);
  }
}

function doBackup(): string {
  const s = getSettings(db);
  const env = realBackupEnv();
  const b = createBackup(db, s.backupDir, env);
  const removed = b.location === "disk" ? applyRetention(db, s.backupDir, s.backupKeepDaily, s.backupKeepWeekly, Date.now()) : [];
  log("백업 완료", b.path, b.location === "pending" ? "(외장 디스크 없음: 임시 보관)" : "", removed.length ? `정리 ${removed.length}개` : "");
  return b.path;
}

function maybeBackup() {
  const s = getSettings(db);
  const now = new Date();
  if (now.getHours() < s.backupHour) return;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const done = db.select().from(backups).where(and(gte(backups.createdAt, today))).get();
  if (done) return;
  try {
    doBackup();
  } catch (e) {
    log("백업 실패", (e as Error).message);
  }
}

function heartbeat() {
  const running = db.select().from(scanJobs).where(eq(scanJobs.result, "running")).all();
  setRuntime("worker", {
    pid: process.pid,
    startedAt,
    current: current ? { ...current, jobs: running.map((j) => ({ id: j.id, sourceId: j.sourceId, processed: j.processed, total: j.totalEstimate })) } : null,
    queued: queue.length,
    watching: [...watchers.keys()],
  });
}

// ---------- 시작 ----------
const startedAt = Date.now();
seedDefaultSources(db);
// 비정상 종료로 running 상태에 남은 작업은 이어서 할 수 있도록 aborted 로 바꾼다
db.update(scanJobs).set({ result: "aborted" }).where(eq(scanJobs.result, "running")).run();
for (const j of db.select().from(scanJobs).where(eq(scanJobs.result, "aborted")).all()) {
  const src = db.select().from(sources).where(eq(sources.id, j.sourceId)).get();
  if (src) enqueueScan({ sourceId: j.sourceId, scope: j.scopePath === src.rootPath ? undefined : j.scopePath });
}
log("시작", `pid ${process.pid}`);

const timers = [
  setInterval(() => void handleCommands().catch((e) => log("명령 처리 오류", e)), 1000),
  setInterval(() => void runQueue().catch((e) => log("스캔 오류", e)), 1000),
  setInterval(() => void checkSources().catch((e) => log("소스 확인 오류", e)), 10_000),
  setInterval(() => void retryDue(db, deps).catch((e) => log("재시도 오류", e)), 30_000),
  setInterval(() => {
    maybeBackup();
    try {
      flushPending(db, getSettings(db).backupDir, realBackupEnv());
    } catch (e) {
      log("임시 백업 이동 실패", (e as Error).message);
    }
  }, 60_000),
  setInterval(heartbeat, 2000),
];
void checkSources();
heartbeat();

async function shutdown() {
  if (stopping) return;
  stopping = true;
  log("종료 중… (진행 중인 스캔은 다음 실행 때 이어서 합니다)");
  timers.forEach(clearInterval);
  for (let i = 0; i < 50 && current; i++) await new Promise((r) => setTimeout(r, 100));
  for (const id of [...watchers.keys()]) await stopWatcher(id);
  setRuntime("worker", { pid: null, stoppedAt: Date.now() });
  db.$client.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
