import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { isMaterializeRefused, isDataless as realIsDataless } from "@/lib/fs/dataless";
import type { Db } from "../db";
import { folders, itemErrors, itemLinks, items, itemTags, scanJobs, sources, tags } from "../db/schema";
import { extractText, isExtractable, kindOf } from "../extract";
import { removeItemText, writeItemText } from "../search/index-writer";
import { nfc } from "../search/text";
import { getSettings, type Settings } from "../settings";
import { checkAvailability, realMountEnv, type MountEnv } from "../sources/availability";
import { isExcludedFolder, isExcludedName, isInside } from "../sources/rules";

type Source = typeof sources.$inferSelect;
type Item = typeof items.$inferSelect;

export type ScanDeps = {
  now: () => number;
  mount: MountEnv;
  isDataless: (p: string, st: fs.Stats) => boolean;
  readFile: (p: string) => Promise<Buffer>;
  /** true를 돌려주면 스캔을 멈추고 cursor를 저장한다 (종료·테스트용) */
  shouldAbort?: () => boolean;
  onProgress?: (jobId: number, processed: number) => void;
};

export const realDeps = (): ScanDeps => ({
  now: Date.now,
  mount: realMountEnv,
  isDataless: realIsDataless,
  readFile: (p) => fsp.readFile(p),
});

/** 재시도 간격: 1분 → 5분 → 30분 → 6시간, 그 뒤로는 오류 목록에만 남긴다 */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 6 * 3600_000];

export type ScanResult = { jobId?: number; result: "ok" | "aborted" | "offline" | "error"; message?: string; deleted?: number };

type Cursor = { stack: string[]; unreadable: string[] };

/**
 * 소스 전체(또는 하위 폴더)를 확인한다.
 * 삭제 판단은 소스가 정상 연결된 상태에서 이 스캔이 끝까지 성공했을 때만 한다.
 */
export async function runScan(db: Db, sourceId: number, deps: ScanDeps, scopePath?: string): Promise<ScanResult> {
  const src = db.select().from(sources).where(eq(sources.id, sourceId)).get();
  if (!src) return { result: "error", message: "소스 없음" };
  const settings = getSettings(db);
  const scope = scopePath ?? src.rootPath;

  const avail = checkAvailability(src, deps.mount);
  if (!avail.ok) {
    db.update(sources).set({ status: avail.status, lastError: avail.reason }).where(eq(sources.id, src.id)).run();
    return { result: "offline", message: avail.reason };
  }

  // 같은 범위의 중단된 스캔이 있으면 이어서 한다
  let job = db
    .select()
    .from(scanJobs)
    .where(and(eq(scanJobs.sourceId, src.id), eq(scanJobs.scopePath, scope), inArray(scanJobs.result, ["running", "aborted"])))
    .get();
  if (!job) {
    const prev = db
      .select({ processed: scanJobs.processed })
      .from(scanJobs)
      .where(and(eq(scanJobs.sourceId, src.id), eq(scanJobs.scopePath, scope), eq(scanJobs.result, "ok")))
      .orderBy(sql`${scanJobs.id} desc`)
      .get();
    job = db
      .insert(scanJobs)
      .values({
        sourceId: src.id,
        kind: scope === src.rootPath ? "full" : "subtree",
        scopePath: scope,
        cursor: JSON.stringify({ stack: [scope], unreadable: [] } satisfies Cursor),
        startedAt: deps.now(),
        totalEstimate: prev?.processed ?? null,
      })
      .returning()
      .get();
  } else {
    db.update(scanJobs).set({ result: "running" }).where(eq(scanJobs.id, job.id)).run();
  }
  const jobId = job.id;
  db.update(sources).set({ status: "syncing" }).where(eq(sources.id, src.id)).run();

  const cursor: Cursor = JSON.parse(job.cursor ?? "null") ?? { stack: [scope], unreadable: [] };
  let processed = job.processed;
  // 이 소스 안에 다른 소스가 등록돼 있으면 그 폴더는 그쪽 소스가 담당한다 (한 번만 인덱싱)
  const nestedRoots = db
    .select({ rootPath: sources.rootPath })
    .from(sources)
    .where(ne(sources.id, src.id))
    .all()
    .map((r) => r.rootPath)
    .filter((r) => isInside(r, src.rootPath) && r !== src.rootPath);

  const saveCursor = () =>
    db.update(scanJobs).set({ cursor: JSON.stringify(cursor), processed }).where(eq(scanJobs.id, jobId)).run();

  try {
    while (cursor.stack.length) {
      if (deps.shouldAbort?.()) {
        saveCursor();
        db.update(scanJobs).set({ result: "aborted" }).where(eq(scanJobs.id, jobId)).run();
        db.update(sources).set({ status: "ok" }).where(eq(sources.id, src.id)).run();
        return { jobId, result: "aborted" };
      }
      const dir = cursor.stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
        const st = await fsp.stat(dir);
        upsertFolder(db, src.id, dir, st, jobId);
      } catch (e) {
        // 디스크가 스캔 도중 분리됐는지 먼저 확인한다
        const again = checkAvailability(src, deps.mount);
        if (!again.ok) throw new OfflineError(again.reason);
        cursor.unreadable.push(dir);
        void e;
        continue;
      }

      const files: { p: string; st: fs.Stats }[] = [];
      for (const ent of entries) {
        const p = path.join(dir, ent.name);
        if (isExcludedName(ent.name, settings.excludedPatterns)) continue;
        if (isExcludedFolder(p, settings.excludedFolders)) continue;
        if (ent.isSymbolicLink()) continue;
        if (ent.isDirectory()) {
          if (nestedRoots.includes(p)) continue;
          cursor.stack.push(p);
        } else if (ent.isFile()) {
          try {
            files.push({ p, st: await fsp.stat(p) });
          } catch {
            // 목록을 읽은 직후 사라진 파일
          }
        }
      }
      await pool(files, settings.concurrency, (f) => processFile(db, src, f.p, f.st, deps, settings, jobId));
      processed += files.length;
      saveCursor();
      deps.onProgress?.(jobId, processed);
    }

    // 끝까지 확인했으면, 마지막으로 소스가 여전히 연결돼 있는지 확인한 뒤에만 삭제를 판단한다
    const final = checkAvailability(src, deps.mount);
    if (!final.ok) throw new OfflineError(final.reason);
    const deleted = finalizeDeletions(db, src, scope, jobId, cursor.unreadable, deps.now(), settings);
    const now = deps.now();
    db.update(scanJobs)
      .set({ result: "ok", finishedAt: now, cursor: null, processed, message: cursor.unreadable.length ? `읽지 못한 폴더 ${cursor.unreadable.length}개` : null })
      .where(eq(scanJobs.id, jobId))
      .run();
    const srcPatch: Partial<Source> = { status: "ok", lastError: null };
    if (scope === src.rootPath) Object.assign(srcPatch, { lastFullScanAt: now, lastFullScanOk: true });
    db.update(sources).set(srcPatch).where(eq(sources.id, src.id)).run();
    return { jobId, result: "ok", deleted };
  } catch (e) {
    saveCursor();
    const offline = e instanceof OfflineError;
    const message = e instanceof Error ? e.message : String(e);
    db.update(scanJobs).set({ result: offline ? "aborted" : "error", message }).where(eq(scanJobs.id, jobId)).run();
    db.update(sources)
      .set({ status: offline ? "offline" : "error", lastError: message, ...(scope === src.rootPath ? { lastFullScanOk: false } : {}) })
      .where(eq(sources.id, src.id))
      .run();
    return { jobId, result: offline ? "offline" : "error", message };
  }
}

class OfflineError extends Error {}

async function pool<T>(xs: T[], n: number, fn: (x: T) => Promise<unknown>) {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(n, xs.length)) }, async () => {
    while (i < xs.length) await fn(xs[i++]);
  });
  await Promise.all(workers);
}

function upsertFolder(db: Db, sourceId: number, p: string, st: fs.Stats, jobId: number | null) {
  const name = nfc(path.basename(p));
  const existing = db.select().from(folders).where(eq(folders.path, p)).get();
  const patch = { sourceId, name, fileId: st.ino, dev: st.dev, state: "ok" as const, modifiedAt: Math.round(st.mtimeMs), deletedDetectedAt: null, ...(jobId ? { seenScanId: jobId } : {}) };
  if (existing) {
    db.update(folders).set(patch).where(eq(folders.id, existing.id)).run();
    return existing.id;
  }
  // 같은 inode의 폴더가 원래 경로에 없으면 이동·이름 변경으로 본다 (프로젝트 폴더 연결 유지)
  const moved = db
    .select()
    .from(folders)
    .where(and(eq(folders.dev, st.dev), eq(folders.fileId, st.ino)))
    .all()
    .find((f) => !fs.existsSync(f.path));
  if (moved) {
    db.update(folders).set({ ...patch, path: p }).where(eq(folders.id, moved.id)).run();
    return moved.id;
  }
  return db.insert(folders).values({ ...patch, path: p }).returning({ id: folders.id }).get().id;
}

function folderIdFor(db: Db, dir: string): number | null {
  return db.select({ id: folders.id }).from(folders).where(eq(folders.path, dir)).get()?.id ?? null;
}

/**
 * 파일 하나를 확인해 items 에 반영한다. (전체 스캔, 변경 감지, 재시도에서 공통 사용)
 */
export async function processFile(
  db: Db,
  src: Source,
  p: string,
  st: fs.Stats,
  deps: ScanDeps,
  settings: Settings = getSettings(db),
  jobId: number | null = null,
): Promise<Item> {
  const mtime = Math.round(st.mtimeMs);
  const ext = path.extname(p).slice(1).toLowerCase();
  const dataless = deps.isDataless(p, st);
  let existing = db.select().from(items).where(eq(items.path, p)).get();

  // 변경 없음: 확인 표시만 한다
  if (
    existing &&
    existing.state !== "deleted" &&
    existing.state !== "extract_failed" &&
    existing.modifiedAt === mtime &&
    existing.size === st.size &&
    existing.fileId === st.ino &&
    (existing.state === "cloud_only") === dataless
  ) {
    if (jobId) db.update(items).set({ seenScanId: jobId }).where(eq(items.id, existing.id)).run();
    return existing;
  }

  // 새 경로면: 같은 inode의 항목이 원래 경로에 없을 때 이동으로 처리한다
  if (!existing) {
    existing = db
      .select()
      .from(items)
      .where(and(eq(items.dev, st.dev), eq(items.fileId, st.ino)))
      .all()
      .find((it) => it.path !== p && !fs.existsSync(it.path));
  }

  const base = {
    sourceId: src.id,
    folderId: folderIdFor(db, path.dirname(p)),
    path: p,
    title: titleOf(p),
    ext,
    kind: kindOf(ext),
    size: st.size,
    fileId: st.ino,
    dev: st.dev,
    createdAt: Math.round(st.birthtimeMs),
    modifiedAt: mtime,
    indexedAt: deps.now(),
    deletedDetectedAt: null,
    ...(jobId ? { seenScanId: jobId } : {}),
  };

  let state: Item["state"] = "ok";
  let noContentReason: string | null = null;
  let body = "";
  let hash: string | null = existing?.contentHash ?? null;
  let tagList: string[] = [];
  let links: string[] = [];
  let error: { kind: string; message: string } | null = null;

  if (dataless) {
    // iCloud에만 있는 파일: 읽으면 다운로드가 시작되므로 메타데이터만 저장
    state = "cloud_only";
    hash = null;
  } else if (!isExtractable(ext)) {
    noContentReason = "unsupported";
  } else if (st.size > settings.maxExtractMB * 1024 * 1024) {
    noContentReason = "too_large";
  } else {
    let buf: Buffer | null = null;
    try {
      buf = await deps.readFile(p);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (isMaterializeRefused(e)) {
        // iCloud 에만 있는 파일을 백그라운드에서 읽으려 한 경우: 오류가 아니라 cloud_only
        state = "cloud_only";
        hash = null;
      } else if (code === "EACCES" || code === "EPERM") {
        state = "no_permission";
        error = { kind: "no_permission", message: "읽기 권한이 없습니다." };
      } else {
        state = "extract_failed";
        error = { kind: "read", message: (e as Error).message };
      }
    }
    if (buf) {
      hash = crypto.createHash("sha256").update(buf).digest("hex");
      // 새 경로인데 inode로 못 찾았으면: 같은 내용의 항목이 원래 경로에 없을 때 이동으로 처리 (다른 볼륨 간 이동 등)
      if (!existing) {
        existing = db
          .select()
          .from(items)
          .where(eq(items.contentHash, hash))
          .all()
          .find((it) => it.path !== p && !fs.existsSync(it.path));
      }
      try {
        const x = await extractText(ext, buf);
        body = x.body;
        tagList = x.tags;
        links = x.links;
      } catch (e) {
        state = "extract_failed";
        error = { kind: "extract", message: (e as Error).message || "텍스트 추출 실패" };
      }
    }
  }

  const row = { ...base, state, noContentReason, contentHash: hash, previewText: body ? nfc(body.slice(0, 300)) : null };
  let saved: Item;
  if (existing) {
    saved = db.update(items).set(row).where(eq(items.id, existing.id)).returning().get();
  } else {
    saved = db.insert(items).values(row).returning().get();
  }
  writeItemText(db, saved.id, { title: saved.title, path: p, body });
  replaceTags(db, saved.id, tagList);
  db.delete(itemLinks).where(eq(itemLinks.itemId, saved.id)).run();
  for (const l of links) db.insert(itemLinks).values({ itemId: saved.id, target: l }).onConflictDoNothing().run();

  if (error) recordError(db, saved.id, error, deps.now());
  else db.delete(itemErrors).where(eq(itemErrors.itemId, saved.id)).run();
  return saved;
}

export function titleOf(p: string): string {
  const base = nfc(path.basename(p));
  return base.toLowerCase().endsWith(".md") ? base.slice(0, -3) : base;
}

function replaceTags(db: Db, itemId: number, names: string[]) {
  db.delete(itemTags).where(eq(itemTags.itemId, itemId)).run();
  for (const n of names) {
    db.insert(tags).values({ name: n }).onConflictDoNothing().run();
    const t = db.select().from(tags).where(eq(tags.name, n)).get()!;
    db.insert(itemTags).values({ itemId, tagId: t.id }).onConflictDoNothing().run();
  }
}

export function recordError(db: Db, itemId: number, e: { kind: string; message: string }, now: number) {
  const prev = db.select().from(itemErrors).where(eq(itemErrors.itemId, itemId)).get();
  const retryCount = prev ? prev.retryCount + 1 : 0;
  const delay = RETRY_DELAYS_MS[retryCount];
  const row = { itemId, kind: e.kind, message: e.message, retryCount, nextRetryAt: delay == null ? null : now + delay, updatedAt: now };
  if (prev) db.update(itemErrors).set(row).where(eq(itemErrors.itemId, itemId)).run();
  else db.insert(itemErrors).values(row).run();
}

/**
 * 이번 스캔에서 보이지 않은 항목을 deleted 로 표시한다. (삭제 판단 규칙)
 * - 읽지 못한 폴더 아래 항목은 판단하지 않는다.
 * - 보관 기간이 지난 deleted 항목만 실제로 지운다.
 */
function finalizeDeletions(db: Db, src: Source, scope: string, jobId: number, unreadable: string[], now: number, settings: Settings): number {
  let count = 0;
  db.transaction(() => {
    const inScope = (p: string) => isInside(p, scope) && !unreadable.some((u) => isInside(p, u));
    const gone = db
      .select({ id: items.id, path: items.path, seen: items.seenScanId })
      .from(items)
      .where(and(eq(items.sourceId, src.id), ne(items.state, "deleted")))
      .all()
      .filter((it) => it.seen !== jobId && inScope(it.path));
    for (const it of gone) {
      db.update(items).set({ state: "deleted", deletedDetectedAt: now }).where(eq(items.id, it.id)).run();
      removeItemText(db, it.id);
      count++;
    }
    const goneFolders = db
      .select({ id: folders.id, path: folders.path, seen: folders.seenScanId })
      .from(folders)
      .where(and(eq(folders.sourceId, src.id), eq(folders.state, "ok")))
      .all()
      .filter((f) => f.seen !== jobId && inScope(f.path));
    for (const f of goneFolders) db.update(folders).set({ state: "deleted", deletedDetectedAt: now }).where(eq(folders.id, f.id)).run();

    purgeDeleted(db, now, settings.deletedRetentionDays);
  });
  return count;
}

/** 보관 기간이 지난 deleted 항목을 지운다 */
export function purgeDeleted(db: Db, now: number, retentionDays: number) {
  const cutoff = now - retentionDays * 86400_000;
  const old = db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.state, "deleted"), lt(items.deletedDetectedAt, cutoff)))
    .all()
    .map((r) => r.id);
  for (let i = 0; i < old.length; i += 500) {
    const ids = old.slice(i, i + 500);
    db.delete(itemTags).where(inArray(itemTags.itemId, ids)).run();
    db.delete(itemLinks).where(inArray(itemLinks.itemId, ids)).run();
    db.delete(itemErrors).where(inArray(itemErrors.itemId, ids)).run();
    db.delete(items).where(inArray(items.id, ids)).run();
  }
  // 폴더는 프로젝트 연결이 "폴더 없음" 경고를 보여줄 수 있도록 지우지 않는다
}

/** 재시도 시각이 된 오류 항목을 다시 처리한다 */
export async function retryDue(db: Db, deps: ScanDeps, itemIds?: number[]) {
  const now = deps.now();
  const due = itemIds
    ? db.select().from(itemErrors).where(inArray(itemErrors.itemId, itemIds)).all()
    : db.select().from(itemErrors).where(lt(itemErrors.nextRetryAt, now + 1)).all();
  await reindexItems(
    db,
    deps,
    due.map((e) => e.itemId),
  );
}

/** 지정한 항목을 수정 여부와 관계없이 다시 처리한다 (재시도, iCloud에서 막 받아온 파일 등) */
export async function reindexItems(db: Db, deps: ScanDeps, ids: number[]) {
  const settings = getSettings(db);
  for (const id of ids) {
    const it = db.select().from(items).where(eq(items.id, id)).get();
    if (!it) {
      db.delete(itemErrors).where(eq(itemErrors.itemId, id)).run();
      continue;
    }
    const src = db.select().from(sources).where(eq(sources.id, it.sourceId)).get();
    if (!src || !checkAvailability(src, deps.mount).ok) continue;
    let st: fs.Stats;
    try {
      st = fs.statSync(it.path);
    } catch {
      continue; // 사라졌으면 다음 전체 스캔에서 판단
    }
    // 수정 시각이 같아도 다시 추출하도록 강제
    db.update(items).set({ modifiedAt: -1 }).where(eq(items.id, it.id)).run();
    await processFile(db, src, it.path, st, deps, settings);
  }
}
