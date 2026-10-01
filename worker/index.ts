/**
 * 인덱서 워커: 웹 서버와 별도 프로세스로 실행된다.
 * - 소스 스캔(전체·하위 폴더), 변경 감지(FSEvents), 주기적 재검사
 * - 외장 디스크 연결·분리 감지
 * - 실패 항목 재시도, DB 자동 백업
 * - 웹에서 넣은 명령(commands 테이블) 처리
 */
import fs from "node:fs";
import path from "node:path";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { applyRetention, createBackup, flushPending, listBackups, PENDING_DIR, realBackupEnv } from "@/server/backup";
import { runEnvCheck } from "@/lib/env-check";
import { openDb } from "@/server/db";
import { backups, commands, runtime, scanJobs, sources } from "@/server/db/schema";
import { getSettings } from "@/server/settings";
import { checkAvailability } from "@/server/sources/availability";
import { refreshSuggestions } from "@/server/projects/suggest";
import { seedDefaultSources } from "@/server/sources/manage";
import { isExcludedFolder, isExcludedName, isInside } from "@/server/sources/rules";
import { processFile, purgeExcluded, realDeps, reindexItems, retryDue, runScan } from "@/server/sync/scanner";
import { DriveClient, driveEnv } from "@/server/connectors/gdrive/client";
import { runDriveChanges, runDriveScan } from "@/server/connectors/gdrive/sync";
import { keychainStore } from "@/server/connectors/gdrive/tokens";
import { NotionClient } from "@/server/connectors/notion/client";
import { runNotionChanges, runNotionScan } from "@/server/connectors/notion/sync";
import { GitHubClient } from "@/server/connectors/github/client";
import { runGitHubChanges, runGitHubScan } from "@/server/connectors/github/sync";
import { FigmaClient } from "@/server/connectors/figma/client";
import { runFigmaScan } from "@/server/connectors/figma/sync";
import { loadEnvLocal } from "@/server/env";
import { Ollama, realOllama } from "@/server/ai/ollama";
import { runAiBatch } from "@/server/ai/pipeline";

loadEnvLocal();
const db = openDb();
let stopping = false;
const deps = { ...realDeps(), shouldAbort: () => stopping };
const log = (...a: unknown[]) => console.log(new Date().toLocaleString("ko-KR"), "[worker]", ...a);

/** Google Drive: 변경 목록 확인 간격 */
const DRIVE_CHANGES_MS = 5 * 60_000;
const lastDriveChanges = new Map<number, number>();
let driveClient: DriveClient | null = null;
function drive() {
  if (!driveClient) driveClient = new DriveClient({ fetch, tokens: keychainStore, ...driveEnv() });
  return driveClient;
}
const isDrive = (s: { kind: string }) => s.kind === "gdrive";
const isNotion = (s: { kind: string }) => s.kind === "notion";
/** 클라우드 소스: 파일 감시 대신 변경 목록을 주기적으로 확인 */
const isGitHub = (s: { kind: string }) => s.kind === "github";
const isFigma = (s: { kind: string }) => s.kind === "figma";
const isCloud = (s: { kind: string }) => isDrive(s) || isNotion(s) || isGitHub(s) || isFigma(s);
const FIGMA_CHANGES_MS = 30 * 60_000;
let figmaClient: FigmaClient | null = null;
function figma() {
  if (!figmaClient) figmaClient = new FigmaClient({ fetch, token: process.env.FIGMA_TOKEN ?? "" });
  return figmaClient;
}
const GITHUB_CHANGES_MS = 15 * 60_000;
let githubClient: GitHubClient | null = null;
function github() {
  if (!githubClient) githubClient = new GitHubClient({ fetch, token: process.env.GITHUB_TOKEN ?? "" });
  return githubClient;
}
const NOTION_CHANGES_MS = 10 * 60_000;
let notionClient: NotionClient | null = null;
function notion() {
  if (!notionClient) notionClient = new NotionClient({ fetch, token: process.env.NOTION_TOKEN ?? "" });
  return notionClient;
}

type Task = { sourceId: number; scope?: string; kind?: "changes" };
const queue: Task[] = [];
let current: Task | null = null;
const watchers = new Map<number, fs.FSWatcher>();
const online = new Map<number, boolean>();

function setRuntime(key: string, value: unknown) {
  db.insert(runtime)
    .values({ key, value, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: runtime.key, set: { value, updatedAt: Date.now() } })
    .run();
}

function enqueueScan(t: Task) {
  // 같은 소스에서 이미 더 넓은 범위가 대기 중이면 생략
  const covered = (a: Task) =>
    a.sourceId === t.sourceId && (a.kind ?? "") === (t.kind ?? "") && (!a.scope || (t.scope && isInside(t.scope, a.scope)));
  if (queue.some(covered) || (current && covered(current) && !t.scope)) return;
  queue.push(t);
}

async function runQueue() {
  if (current || !queue.length || stopping) return;
  current = queue.shift()!;
  const src = db.select().from(sources).where(eq(sources.id, current.sourceId)).get();
  if (src?.enabled && isFigma(src)) {
    const full = current.kind !== "changes";
    if (full) log("스캔 시작", src.name, "(Figma 전체)");
    const r = await runFigmaScan(db, src.id, { client: figma(), now: Date.now, shouldAbort: () => stopping }, full);
    if (full || r.result !== "ok") log(full ? "스캔 종료" : "Figma 변경 확인", src.name, r.result, r.message ?? "", r.deleted ? `삭제 ${r.deleted}` : "");
    if (full && r.result === "ok") updateSuggestions();
  } else if (src?.enabled && isGitHub(src) && current.kind === "changes") {
    const r = await runGitHubChanges(db, src.id, { client: github(), now: Date.now });
    if (r.result !== "skipped" && (r.result !== "ok" || r.changed)) log("GitHub 변경 반영", src.name, r.result, r.changed ?? "", r.message ?? "");
  } else if (src?.enabled && isGitHub(src)) {
    log("스캔 시작", src.name, "(GitHub 전체)");
    const r = await runGitHubScan(db, src.id, { client: github(), now: Date.now, shouldAbort: () => stopping });
    log("스캔 종료", src.name, r.result, r.message ?? "", r.deleted ? `삭제 ${r.deleted}` : "");
    if (r.result === "ok") updateSuggestions();
  } else if (src?.enabled && isNotion(src) && current.kind === "changes") {
    const r = await runNotionChanges(db, src.id, { client: notion(), now: Date.now });
    if (r.result !== "skipped" && (r.result !== "ok" || r.changed)) log("Notion 변경 반영", src.name, r.result, r.changed ?? "", r.message ?? "");
  } else if (src?.enabled && isNotion(src)) {
    log("스캔 시작", src.name, "(Notion 전체)");
    const r = await runNotionScan(db, src.id, { client: notion(), now: Date.now, shouldAbort: () => stopping });
    log("스캔 종료", src.name, r.result, r.message ?? "", r.deleted ? `삭제 ${r.deleted}` : "");
    if (r.result === "ok") updateSuggestions();
  } else if (src?.enabled && isDrive(src) && current.kind === "changes") {
    const r = await runDriveChanges(db, src.id, { client: drive(), now: Date.now });
    if (r.result !== "skipped" && (r.result !== "ok" || r.changed)) log("Drive 변경 반영", src.name, r.result, r.changed ?? "", r.message ?? "");
  } else if (src?.enabled && isDrive(src)) {
    log("스캔 시작", src.name, "(Google Drive 전체)");
    const r = await runDriveScan(db, src.id, { client: drive(), now: Date.now, shouldAbort: () => stopping });
    log("스캔 종료", src.name, r.result, r.message ?? "", r.deleted ? `삭제 ${r.deleted}` : "");
    if (r.result === "ok") updateSuggestions();
  } else if (src?.enabled) {
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

/**
 * 변경 감지: macOS FSEvents 기반 재귀 감시 (소스당 핸들 1개).
 * 폴더마다 핸들을 여는 방식은 큰 폴더(수만 개)에서 파일 핸들이 부족해진다.
 * 이벤트는 경로 단위로 2초 모았다가 처리한다. 파일이 있으면 다시 색인하고, 없거나 폴더면 그 폴더를 다시 확인한다.
 */
function startWatcher(src: typeof sources.$inferSelect) {
  if (watchers.has(src.id)) return;
  const settings = getSettings(db);
  const nested = db
    .select({ rootPath: sources.rootPath })
    .from(sources)
    .all()
    .map((r) => r.rootPath)
    .filter((r) => r !== src.rootPath && isInside(r, src.rootPath));
  const ignored = (p: string) => {
    const rel = p.slice(src.rootPath.length + 1).split("/");
    return (
      rel.some((seg) => isExcludedName(seg, settings.excludedPatterns)) || isExcludedFolder(p, settings.excludedFolders) || nested.some((n) => isInside(p, n))
    );
  };
  const pending = new Set<string>();
  let timer: NodeJS.Timeout | null = null;
  const flush = async () => {
    timer = null;
    const paths = [...pending];
    pending.clear();
    for (const p of paths) {
      let st: fs.Stats;
      try {
        st = fs.lstatSync(p);
      } catch {
        // 사라짐: 삭제는 바로 반영하지 않고, 그 폴더를 끝까지 다시 확인한 뒤 판단한다 (삭제 판단 규칙)
        scheduleSubtree(src.id, path.dirname(p));
        continue;
      }
      if (st.isSymbolicLink()) continue; // 스캔과 같은 규칙: 심볼릭 링크는 따라가지 않는다
      if (st.isDirectory()) scheduleSubtree(src.id, p);
      else if (st.isFile()) await processFile(db, src, p, fs.statSync(p), deps).catch((e) => log("변경 처리 오류", p, String(e)));
    }
  };
  let w: fs.FSWatcher;
  try {
    w = fs.watch(src.rootPath, { recursive: true, persistent: true }, (_event, filename) => {
      if (!filename) return;
      const p = path.join(src.rootPath, filename.toString());
      if (ignored(p)) return;
      pending.add(p);
      if (!timer) timer = setTimeout(() => void flush(), 2000);
    });
  } catch (e) {
    log("감시 시작 실패", src.name, String(e));
    return;
  }
  w.on("error", (e) => log("감시 오류", src.name, String(e)));
  watchers.set(src.id, w);
}

async function stopWatcher(id: number) {
  watchers.get(id)?.close();
  watchers.delete(id);
}

// ---------- 주기 작업 ----------
async function checkSources() {
  const settings = getSettings(db);
  for (const src of db.select().from(sources).where(eq(sources.enabled, true)).all()) {
    if (isCloud(src)) {
      // Google Drive·Notion: 파일 감시 대신 변경 목록을 주기적으로 확인한다. 연결 상태는 API 호출 결과로 정해진다.
      const due = !src.lastFullScanAt || Date.now() - src.lastFullScanAt > settings.fullScanIntervalHours * 3600_000;
      if (due && src.status !== "syncing") enqueueScan({ sourceId: src.id });
      else if (Date.now() - (lastDriveChanges.get(src.id) ?? 0) > (isNotion(src) ? NOTION_CHANGES_MS : isGitHub(src) ? GITHUB_CHANGES_MS : isFigma(src) ? FIGMA_CHANGES_MS : DRIVE_CHANGES_MS)) {
        lastDriveChanges.set(src.id, Date.now());
        enqueueScan({ sourceId: src.id, kind: "changes" });
      }
      continue;
    }
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
        case "drive_connected":
          driveClient = null; // 새 토큰으로 다시 만든다
          for (const s of db.select().from(sources).where(eq(sources.kind, "gdrive")).all()) enqueueScan({ sourceId: s.id });
          break;
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
        case "ai_run_now":
          void aiTick(true);
          break;
        case "refresh_suggestions":
          updateSuggestions();
          break;
        case "backup":
          result = doBackup();
          await recordEnv();
          break;
        case "settings_changed": {
          const n = purgeExcluded(db);
          if (n) log("제외 규칙 적용: 색인에서 뺀 항목", n);
        }
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

/** 디스크·백업 정보를 기록한다. 웹 화면은 이 기록만 읽고 디스크를 직접 읽지 않는다. */
async function recordEnv() {
  const s = getSettings(db);
  const env = await runEnvCheck();
  const safeList = (dir: string) => {
    try {
      return listBackups(dir).slice(0, 30);
    } catch {
      return [];
    }
  };
  setRuntime("env", { volumes: env.volumes, paths: env.paths, backups: safeList(s.backupDir), pending: safeList(PENDING_DIR), at: Date.now() });
}

// ---------- 로컬 AI (스캔이 없을 때 1분마다 조금씩) ----------
const ollama = new Ollama(realOllama());
let aiRunning = false;
async function aiTick(force = false) {
  if (aiRunning || stopping || (!force && (current || queue.length))) return;
  aiRunning = true;
  try {
    const t0 = Date.now();
    const r = await runAiBatch(db, ollama);
    setRuntime("ai", { ...r, at: Date.now(), ms: Date.now() - t0 });
    if (r.embedded || r.chunked || r.projectSuggested || r.tagged)
      log("AI 정리", `임베딩 ${r.embedded}`, `검색 조각 ${r.chunked}`, `프로젝트 제안 ${r.projectSuggested}`, `태그 제안 ${r.tagged}`);
    else if (r.status !== "ok" && r.status !== "off") log("AI 정리 대기", r.status, r.message ?? "");
  } finally {
    aiRunning = false;
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
{
  const n = purgeExcluded(db);
  if (n) log("제외 규칙 적용: 색인에서 뺀 항목", n);
}

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
  setInterval(() => void aiTick().catch((e) => log("AI 오류", e)), 60_000),
  setInterval(() => void recordEnv().catch((e) => log("환경 기록 오류", e)), 30_000),
];
void recordEnv();
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
