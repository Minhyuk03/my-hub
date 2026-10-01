/**
 * 클라우드 소스(Google Drive, Notion 등) 공통 도우미
 * 경로 규칙: "<종류>:/<루트ID>/이름#ID/이름#ID" — 같은 이름이 있어도 겹치지 않고, 프로젝트 폴더 연결(경로 앞부분 비교)을 그대로 쓴다.
 * 폴더·항목은 원본 ID(external_id)로 추적하므로 이동·이름 변경에도 같은 항목·같은 연결이 유지된다.
 */
import { and, eq, gt, lt, ne } from "drizzle-orm";
import type { Db } from "../db";
import { folders, items, sources } from "../db/schema";
import { removeItemText, writeItemText } from "../search/index-writer";

export const seg = (name: string, id: string) => `${(name || "제목 없음").normalize("NFC").replace(/\//g, "／").replace(/#/g, "＃")}#${id}`;

const ROOT_LABEL: Record<string, string> = { gdrive: "Google Drive", notion: "Notion", github: "GitHub", figma: "Figma", chat: "AI 대화" };
/** 화면·검색용 경로: ID 조각을 뺀다 → "Google Drive/블로그 리뉴얼/기획서" */
export const cloudPathLabel = (p: string) => p.replace(/^(gdrive|notion|github|figma|chat):\/[^/]+/, (_, k: string) => ROOT_LABEL[k] ?? k).replace(/#[A-Za-z0-9_-]+/g, "");

export function patchSourceConfig(db: Db, sourceId: number, patch: Record<string, unknown>) {
  const cur = db.select({ config: sources.config }).from(sources).where(eq(sources.id, sourceId)).get()?.config ?? {};
  db.update(sources).set({ config: { ...cur, ...patch } }).where(eq(sources.id, sourceId)).run();
}

/** 폴더를 ID 기준으로 저장한다. 경로가 바뀌었으면(이동·이름 변경) 아래 항목 경로도 함께 고친다. */
export function upsertCloudFolder(db: Db, src: { id: number }, id: string, name: string, path: string, modifiedAt: number | null, jobId: number | null): number {
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
    writeItemText(db, it.id, { title: it.title, path: cloudPathLabel(np), body });
  }
}


/** 원본에서 지워진 항목·폴더(와 그 아래)를 deleted 로 표시 */
export function markDeletedByExternal(db: Db, sourceId: number, externalId: string, now: number): number {
  const src = { id: sourceId };
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

