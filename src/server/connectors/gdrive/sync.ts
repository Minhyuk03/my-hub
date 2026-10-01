/**
 * Google Drive 동기화 (선택한 폴더 단위)
 *
 * 경로 규칙: 소스 루트 = "gdrive:/<루트폴더ID>", 그 아래는 "이름#ID" 조각을 "/"로 잇는다.
 *   예) gdrive:/1AbC/블로그 리뉴얼#1XyZ/기획서#1Qwe
 *   → 이름이 같은 파일이 있어도 경로가 겹치지 않고, 프로젝트 폴더 연결(경로 앞부분 비교)도 그대로 쓸 수 있다.
 * 폴더·파일은 Drive ID(external_id)로 추적하므로 이동·이름 변경에도 같은 항목·같은 연결이 유지된다.
 *
 * 삭제 판단: 전체 확인(full scan)이 끝까지 성공했을 때, 또는 Drive 변경 목록이 "삭제/휴지통"을 알려 줬을 때만.
 * 토큰 만료·네트워크 끊김은 오프라인으로 표시하고 아무것도 지우지 않는다.
 */
import { and, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import type { Db } from "../../db";
import { folders, items, scanJobs, sources } from "../../db/schema";
import { extractText, isExtractable, kindOf } from "../../extract";
import { removeItemText, writeItemText } from "../../search/index-writer";
import { getSettings, type Settings } from "../../settings";
import { finalizeDeletions, purgeExcluded, recordError } from "../../sync/scanner";
import { EXPORTS, FOLDER_MIME, SHORTCUT_MIME, TokenError, type DriveClient, type DriveFile } from "./client";

type Source = typeof sources.$inferSelect;
export type DriveConfig = { folderId: string; folderName?: string; pageToken?: string };
export type DriveSyncDeps = { client: DriveClient; now: () => number; shouldAbort?: () => boolean };

export const driveRoot = (folderId: string) => `gdrive:/${folderId}`;
const seg = (name: string, id: string) => `${name.normalize("NFC").replace(/\//g, "／").replace(/#/g, "＃")}#${id}`;
/** 화면·검색용 경로: ID 조각을 뺀다 → "Google Drive/블로그 리뉴얼/기획서" */
export const drivePathLabel = (p: string) => p.replace(/^gdrive:\/[^/]+/, "Google Drive").replace(/#[A-Za-z0-9_-]+/g, "");

const cfgOf = (src: Source) => (src.config ?? {}) as DriveConfig;
const ts = (iso?: string) => (iso ? Date.parse(iso) : null);

function setConfig(db: Db, src: Source, patch: Partial<DriveConfig>) {
  const cur = db.select({ config: sources.config }).from(sources).where(eq(sources.id, src.id)).get()?.config ?? {};
  db.update(sources).set({ config: { ...cur, ...patch } }).where(eq(sources.id, src.id)).run();
}

class OfflineError extends Error {}

function classify(e: unknown): { status: "offline" | "error"; message: string } {
  if (e instanceof TokenError || e instanceof OfflineError) return { status: "offline", message: e.message };
  const msg = e instanceof Error ? e.message : String(e);
  if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network/i.test(msg)) return { status: "offline", message: "네트워크에 연결할 수 없습니다." };
  return { status: "error", message: msg };
}

// ---------- 폴더 ----------
/** 폴더를 ID 기준으로 저장한다. 경로가 바뀌었으면(이동·이름 변경) 아래 항목 경로도 함께 고친다. */
export function upsertDriveFolder(db: Db, src: Source, id: string, name: string, path: string, modifiedAt: number | null, jobId: number | null): number {
  const existing = db.select().from(folders).where(and(eq(folders.sourceId, src.id), eq(folders.externalId, id))).get();
  const patch = { name: name.normalize("NFC"), state: "ok" as const, modifiedAt, deletedDetectedAt: null, ...(jobId ? { seenScanId: jobId } : {}) };
  if (existing) {
    if (existing.path !== path) rewritePrefix(db, existing.path, path);
    db.update(folders).set({ ...patch, path }).where(eq(folders.id, existing.id)).run();
    return existing.id;
  }
  return db.insert(folders).values({ ...patch, sourceId: src.id, path, externalId: id }).returning({ id: folders.id }).get().id;
}

/** "old/..." 경로를 "new/..." 로 일괄 변경 (폴더·항목·검색용 경로) */
function rewritePrefix(db: Db, oldPath: string, newPath: string) {
  const lo = oldPath + "/";
  const hi = oldPath + "0";
  const c = db.$client;
  const movedItems = db.select({ id: items.id, path: items.path, title: items.title }).from(items).where(and(gt(items.path, lo), lt(items.path, hi))).all();
  c.prepare(`UPDATE folders SET path = ? || substr(path, ?) WHERE path > ? AND path < ?`).run(newPath, oldPath.length + 1, lo, hi);
  c.prepare(`UPDATE items SET path = ? || substr(path, ?) WHERE path > ? AND path < ?`).run(newPath, oldPath.length + 1, lo, hi);
  for (const it of movedItems) {
    const np = newPath + it.path.slice(oldPath.length);
    const body = (c.prepare(`SELECT body FROM item_text WHERE item_id = ?`).pluck().get(it.id) as string | undefined) ?? "";
    writeItemText(db, it.id, { title: it.title, path: drivePathLabel(np), body });
  }
}

// ---------- 파일 ----------
export async function processDriveFile(db: Db, src: Source, client: DriveClient, f: DriveFile, parentPath: string, folderId: number | null, jobId: number | null, settings: Settings, now: number) {
  const path = `${parentPath}/${seg(f.name, f.id)}`;
  const modifiedAt = ts(f.modifiedTime);
  const size = Number(f.size ?? 0);
  const ex = EXPORTS[f.mimeType];
  const ext = ex ? ex.ext : (f.name.match(/\.([^.]+)$/)?.[1] ?? "").toLowerCase();
  const version = f.md5Checksum ?? f.modifiedTime ?? null;
  let existing = db.select().from(items).where(and(eq(items.sourceId, src.id), eq(items.externalId, f.id))).get();

  // 내용이 그대로면 경로만 맞추고 다시 받지 않는다
  if (existing && existing.state !== "deleted" && existing.state !== "extract_failed" && existing.contentHash === version && existing.modifiedAt === modifiedAt) {
    if (existing.path !== path || existing.title !== f.name.normalize("NFC")) {
      db.update(items).set({ path, title: f.name.normalize("NFC"), folderId }).where(eq(items.id, existing.id)).run();
      const body = (db.$client.prepare(`SELECT body FROM item_text WHERE item_id = ?`).pluck().get(existing.id) as string | undefined) ?? "";
      writeItemText(db, existing.id, { title: f.name, path: drivePathLabel(path), body });
    }
    if (jobId) db.update(items).set({ seenScanId: jobId }).where(eq(items.id, existing.id)).run();
    return existing;
  }
  if (!existing) {
    // 같은 경로에 예전 기록이 남아 있으면 이어서 쓴다
    existing = db.select().from(items).where(eq(items.path, path)).get();
  }

  let state: "ok" | "extract_failed" = "ok";
  let noContentReason: string | null = null;
  let body = "";
  let error: { kind: string; message: string } | null = null;
  const extractable = !!ex || isExtractable(ext);
  if (!extractable) noContentReason = "unsupported";
  else if (!ex && size > settings.maxExtractMB * 1024 * 1024) noContentReason = "too_large";
  else {
    try {
      const buf = await client.content(f);
      body = (await extractText(ex ? (ex.ext === "gsheet" ? "csv" : "txt") : ext, buf)).body;
    } catch (e) {
      if (e instanceof TokenError) throw e;
      state = "extract_failed";
      error = { kind: "extract", message: e instanceof Error ? e.message : String(e) };
    }
  }

  const row = {
    sourceId: src.id,
    folderId,
    path,
    externalId: f.id,
    url: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view`,
    title: f.name.normalize("NFC"),
    ext,
    kind: ex ? "document" : kindOf(ext),
    size,
    contentHash: version,
    fileId: null,
    dev: null,
    state,
    noContentReason,
    createdAt: ts(f.createdTime),
    modifiedAt,
    indexedAt: now,
    deletedDetectedAt: null,
    previewText: body ? body.slice(0, 300).normalize("NFC") : null,
    ...(jobId ? { seenScanId: jobId } : {}),
  };
  const saved = existing
    ? db.update(items).set(row).where(eq(items.id, existing.id)).returning().get()
    : db.insert(items).values(row).returning().get();
  writeItemText(db, saved.id, { title: saved.title, path: drivePathLabel(path), body });
  if (error) recordError(db, saved.id, error, now);
  else db.$client.prepare(`DELETE FROM item_errors WHERE item_id = ?`).run(saved.id);
  return saved;
}

async function pool<T>(xs: T[], n: number, fn: (x: T) => Promise<unknown>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(n, xs.length)) }, async () => {
      while (i < xs.length) await fn(xs[i++]);
    }),
  );
}

/** 폴더 하나의 바로 아래 항목을 처리하고, 하위 폴더 목록을 돌려준다 */
async function scanFolder(db: Db, src: Source, d: DriveSyncDeps, folder: { id: string; path: string; rowId: number }, jobId: number | null, settings: Settings) {
  const subs: { id: string; path: string; rowId: number }[] = [];
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const page = await d.client.listChildren(folder.id, pageToken);
    for (const f of page.files) {
      if (f.trashed || f.mimeType === SHORTCUT_MIME) continue;
      if (f.mimeType === FOLDER_MIME) {
        const p = `${folder.path}/${seg(f.name, f.id)}`;
        subs.push({ id: f.id, path: p, rowId: upsertDriveFolder(db, src, f.id, f.name, p, ts(f.modifiedTime), jobId) });
      } else files.push(f);
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  await pool(files, settings.concurrency, (f) => processDriveFile(db, src, d.client, f, folder.path, folder.rowId, jobId, settings, d.now()));
  return { subs, count: files.length };
}

// ---------- 전체 확인 ----------
type Cursor = { stack: { id: string; path: string; rowId: number }[] };

export async function runDriveScan(db: Db, sourceId: number, d: DriveSyncDeps): Promise<{ jobId?: number; result: "ok" | "aborted" | "offline" | "error"; message?: string; deleted?: number }> {
  const src = db.select().from(sources).where(eq(sources.id, sourceId)).get();
  if (!src) return { result: "error", message: "소스 없음" };
  const cfg = cfgOf(src);
  const settings = getSettings(db);
  const fail = (e: unknown, jobId?: number) => {
    const c = classify(e);
    db.update(sources).set({ status: c.status, lastError: c.message, lastFullScanOk: false }).where(eq(sources.id, src.id)).run();
    if (jobId) db.update(scanJobs).set({ result: c.status === "offline" ? "aborted" : "error", message: c.message }).where(eq(scanJobs.id, jobId)).run();
    return { jobId, result: c.status === "offline" ? ("offline" as const) : ("error" as const), message: c.message };
  };

  let rootInfo: DriveFile;
  try {
    rootInfo = await d.client.getFile(cfg.folderId);
    if (rootInfo.trashed) throw new Error("폴더 없음 (Drive 휴지통에 있음)");
  } catch (e) {
    return fail(e);
  }
  // 변경 목록은 스캔 시작 시점부터 따라가야 스캔 중 바뀐 것을 놓치지 않는다
  let startToken = cfg.pageToken;
  try {
    if (!startToken) startToken = await d.client.startPageToken();
  } catch (e) {
    return fail(e);
  }

  let job = db
    .select()
    .from(scanJobs)
    .where(and(eq(scanJobs.sourceId, src.id), eq(scanJobs.scopePath, src.rootPath), inArray(scanJobs.result, ["running", "aborted"])))
    .get();
  const rootRowId = upsertDriveFolder(db, src, cfg.folderId, rootInfo.name, src.rootPath, ts(rootInfo.modifiedTime), null);
  if (!job) {
    const prev = db
      .select({ processed: scanJobs.processed })
      .from(scanJobs)
      .where(and(eq(scanJobs.sourceId, src.id), eq(scanJobs.result, "ok")))
      .orderBy(sql`${scanJobs.id} desc`)
      .get();
    job = db
      .insert(scanJobs)
      .values({
        sourceId: src.id,
        kind: "full",
        scopePath: src.rootPath,
        cursor: JSON.stringify({ stack: [{ id: cfg.folderId, path: src.rootPath, rowId: rootRowId }] } satisfies Cursor),
        startedAt: d.now(),
        totalEstimate: prev?.processed ?? null,
      })
      .returning()
      .get();
  } else db.update(scanJobs).set({ result: "running" }).where(eq(scanJobs.id, job.id)).run();
  const jobId = job.id;
  db.update(folders).set({ seenScanId: jobId }).where(eq(folders.id, rootRowId)).run();
  db.update(sources).set({ status: "syncing", name: src.name }).where(eq(sources.id, src.id)).run();

  const cursor = JSON.parse(job.cursor ?? "null") as Cursor;
  let processed = job.processed;
  const save = () => db.update(scanJobs).set({ cursor: JSON.stringify(cursor), processed }).where(eq(scanJobs.id, jobId)).run();
  try {
    while (cursor.stack.length) {
      if (d.shouldAbort?.()) {
        save();
        db.update(scanJobs).set({ result: "aborted" }).where(eq(scanJobs.id, jobId)).run();
        db.update(sources).set({ status: "ok" }).where(eq(sources.id, src.id)).run();
        return { jobId, result: "aborted" };
      }
      const folder = cursor.stack[cursor.stack.length - 1];
      db.update(folders).set({ seenScanId: jobId }).where(eq(folders.id, folder.rowId)).run();
      const r = await scanFolder(db, src, d, folder, jobId, settings);
      cursor.stack.pop();
      cursor.stack.push(...r.subs);
      processed += r.count;
      save();
    }
    purgeExcluded(db, settings);
    const deleted = finalizeDeletions(db, src, src.rootPath, jobId, [], d.now(), settings);
    const now = d.now();
    db.update(scanJobs).set({ result: "ok", finishedAt: now, cursor: null, processed }).where(eq(scanJobs.id, jobId)).run();
    setConfig(db, src, { pageToken: startToken, folderName: rootInfo.name });
    db.update(sources).set({ status: "ok", lastError: null, lastFullScanAt: now, lastFullScanOk: true }).where(eq(sources.id, src.id)).run();
    return { jobId, result: "ok", deleted };
  } catch (e) {
    save();
    return fail(e, jobId);
  }
}

// ---------- 변경 반영 ----------
function markDeleted(db: Db, src: Source, externalId: string, now: number): number {
  let n = 0;
  const it = db.select().from(items).where(and(eq(items.sourceId, src.id), eq(items.externalId, externalId))).get();
  if (it && it.state !== "deleted") {
    db.update(items).set({ state: "deleted", deletedDetectedAt: now }).where(eq(items.id, it.id)).run();
    removeItemText(db, it.id);
    n++;
  }
  const f = db.select().from(folders).where(and(eq(folders.sourceId, src.id), eq(folders.externalId, externalId))).get();
  if (f && f.state !== "deleted") {
    db.update(folders).set({ state: "deleted", deletedDetectedAt: now }).where(eq(folders.id, f.id)).run();
    const lo = f.path + "/";
    const hi = f.path + "0";
    for (const c of db.select({ id: items.id }).from(items).where(and(eq(items.sourceId, src.id), gt(items.path, lo), lt(items.path, hi), ne(items.state, "deleted"))).all()) {
      db.update(items).set({ state: "deleted", deletedDetectedAt: now }).where(eq(items.id, c.id)).run();
      removeItemText(db, c.id);
      n++;
    }
    db.update(folders).set({ state: "deleted", deletedDetectedAt: now }).where(and(eq(folders.sourceId, src.id), gt(folders.path, lo), lt(folders.path, hi))).run();
  }
  return n;
}

/** Drive 변경 목록으로 바뀐 것만 반영한다 */
export async function runDriveChanges(db: Db, sourceId: number, d: DriveSyncDeps): Promise<{ result: "ok" | "offline" | "error" | "skipped"; changed?: number; message?: string }> {
  const src = db.select().from(sources).where(eq(sources.id, sourceId)).get();
  if (!src) return { result: "error", message: "소스 없음" };
  const cfg = cfgOf(src);
  if (!cfg.pageToken) return { result: "skipped" };
  const settings = getSettings(db);
  let token = cfg.pageToken;
  let changed = 0;
  try {
    for (;;) {
      const page = await d.client.changes(token);
      for (const ch of page.changes) {
        const now = d.now();
        const f = ch.file;
        if (ch.removed || !f || f.trashed) {
          changed += markDeleted(db, src, ch.fileId, now);
          continue;
        }
        if (f.mimeType === SHORTCUT_MIME) continue;
        // 부모 폴더가 이 소스 안에 있는지 확인 (없으면 범위 밖으로 옮겨진 것)
        const parentId = f.parents?.[0];
        const parent = parentId
          ? db
              .select()
              .from(folders)
              .where(and(eq(folders.sourceId, src.id), eq(folders.externalId, parentId), eq(folders.state, "ok")))
              .get()
          : undefined;
        if (f.id === cfg.folderId) continue; // 루트 폴더 자체의 이름 변경 등은 전체 확인 때 반영
        if (!parent) {
          changed += markDeleted(db, src, f.id, now);
          continue;
        }
        if (f.mimeType === FOLDER_MIME) {
          const p = `${parent.path}/${seg(f.name, f.id)}`;
          const isNew = !db.select().from(folders).where(and(eq(folders.sourceId, src.id), eq(folders.externalId, f.id), eq(folders.state, "ok"))).get();
          const rowId = upsertDriveFolder(db, src, f.id, f.name, p, ts(f.modifiedTime), null);
          // 다른 곳에서 옮겨 온 폴더는 안의 내용을 따로 알려 주지 않으므로 직접 훑는다
          if (isNew) {
            const stack = [{ id: f.id, path: p, rowId }];
            while (stack.length) {
              const r = await scanFolder(db, src, d, stack.pop()!, null, settings);
              stack.push(...r.subs);
              changed += r.count;
            }
          }
          changed++;
        } else {
          await processDriveFile(db, src, d.client, f, parent.path, parent.id, null, settings, now);
          changed++;
        }
      }
      if (page.nextPageToken) token = page.nextPageToken;
      else {
        token = page.newStartPageToken ?? token;
        break;
      }
    }
    setConfig(db, src, { pageToken: token });
    if (src.status !== "syncing") db.update(sources).set({ status: "ok", lastError: null }).where(eq(sources.id, src.id)).run();
    return { result: "ok", changed };
  } catch (e) {
    const c = classify(e);
    db.update(sources).set({ status: c.status, lastError: c.message }).where(eq(sources.id, src.id)).run();
    return { result: c.status, message: c.message };
  }
}
