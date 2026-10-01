/**
 * Notion 동기화 (루트 페이지 아래 전체)
 * - 페이지·데이터베이스는 "폴더"로도 기록해(하위 페이지를 담으므로) 프로젝트에 연결할 수 있게 한다.
 *   페이지 본문은 같은 경로의 항목으로 저장한다 → 프로젝트에 페이지를 연결하면 그 페이지와 하위 페이지가 함께 들어간다.
 * - 전체 확인: 통합이 볼 수 있는 페이지 목록(search)에서 루트 아래만 고르고, 수정 시각이 바뀐 페이지만 본문을 받는다.
 *   끝까지 성공했을 때만 사라진 페이지를 deleted 로 표시한다 (보관·휴지통으로 옮긴 페이지는 목록에서 빠짐).
 * - 변경 반영: 최근 수정 순 목록을 마지막 동기화 시각까지만 읽는다.
 * - 토큰 오류·페이지 미공유·네트워크 끊김은 오프라인으로 표시하고 아무것도 지우지 않는다.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "../../db";
import { folders, items, scanJobs, sources } from "../../db/schema";
import { writeItemText } from "../../search/index-writer";
import { getSettings } from "../../settings";
import { finalizeDeletions, purgeExcluded, replaceTags } from "../../sync/scanner";
import { cloudPathLabel, patchSourceConfig, seg, upsertCloudFolder } from "../common";
import { blockText, normId, NotionAuthError, NotionNotFound, pageTitle, propertyText, type NDatabase, type NotionClient, type NPage, type NParent } from "./client";

type Source = typeof sources.$inferSelect;
export type NotionConfig = { rootId: string; rootTitle?: string; lastEditedSync?: number };
export type NotionSyncDeps = { client: NotionClient; now: () => number; shouldAbort?: () => boolean };
type Obj = NPage | NDatabase;

export const notionRoot = (rootId: string) => `notion:/${rootId}`;
const ts = (iso?: string) => (iso ? Date.parse(iso) : null);

function classify(e: unknown): { status: "offline" | "error"; message: string } {
  if (e instanceof NotionAuthError || e instanceof NotionNotFound) return { status: "offline", message: e.message };
  const msg = e instanceof Error ? e.message : String(e);
  if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network/i.test(msg)) return { status: "offline", message: "네트워크에 연결할 수 없습니다." };
  return { status: "error", message: msg };
}

/** 부모 ID 찾기. 블록 안에 든 페이지(열·동기화 블록 등)는 블록을 거슬러 올라가 페이지를 찾는다 */
async function parentOf(client: NotionClient, parent: NParent, cache: Map<string, string | null>): Promise<string | null> {
  if (parent.type === "page_id" && parent.page_id) return normId(parent.page_id);
  if (parent.type === "database_id" && parent.database_id) return normId(parent.database_id);
  if (parent.type !== "block_id" || !parent.block_id) return null;
  let id = normId(parent.block_id)!;
  const start = id;
  if (cache.has(start)) return cache.get(start)!;
  for (let i = 0; i < 10; i++) {
    const b = await client.getBlock(id).catch(() => null);
    if (!b) break;
    const p = b.parent;
    if (p.type === "page_id" || p.type === "database_id") {
      const r = normId((p.page_id ?? p.database_id)!);
      cache.set(start, r);
      return r;
    }
    if (p.type !== "block_id" || !p.block_id) break;
    id = normId(p.block_id)!;
  }
  cache.set(start, null);
  return null;
}

/** 페이지 하나를 items 에 반영 (본문이 그대로면 다시 받지 않음) */
export async function processNotionPage(db: Db, src: Source, client: NotionClient, p: NPage, path: string, folderId: number | null, jobId: number | null, now: number) {
  const id = normId(p.id)!;
  const title = pageTitle(p).normalize("NFC");
  const version = p.last_edited_time;
  const existing = db.select().from(items).where(and(eq(items.sourceId, src.id), eq(items.externalId, id))).get();
  if (existing && existing.state !== "deleted" && existing.contentHash === version) {
    if (existing.path !== path || existing.title !== title || existing.folderId !== folderId) {
      db.update(items).set({ path, title, folderId }).where(eq(items.id, existing.id)).run();
      const body = (db.$client.prepare(`SELECT body FROM item_text WHERE item_id = ?`).pluck().get(existing.id) as string | undefined) ?? "";
      writeItemText(db, existing.id, { title, path: cloudPathLabel(path), body });
    }
    if (jobId) db.update(items).set({ seenScanId: jobId }).where(eq(items.id, existing.id)).run();
    return existing;
  }
  const blocks = await client.allBlocks(id);
  const props = propertyText(p);
  const body = [...props.lines, ...blocks.map(({ block, depth }) => "  ".repeat(depth) + blockText(block)).filter((l) => l.trim())].join("\n");
  const row = {
    sourceId: src.id,
    folderId,
    path,
    externalId: id,
    url: p.url,
    title,
    ext: "notion",
    kind: "document",
    size: body.length,
    contentHash: version,
    fileId: null,
    dev: null,
    state: "ok" as const,
    noContentReason: null,
    createdAt: ts(p.created_time),
    modifiedAt: ts(p.last_edited_time),
    indexedAt: now,
    deletedDetectedAt: null,
    previewText: body.slice(0, 300) || null,
    ...(jobId ? { seenScanId: jobId } : {}),
  };
  const saved = existing ? db.update(items).set(row).where(eq(items.id, existing.id)).returning().get() : db.insert(items).values(row).returning().get();
  writeItemText(db, saved.id, { title, path: cloudPathLabel(path), body });
  replaceTags(db, saved.id, props.tags);
  return saved;
}

/** 목록 전체 받기 */
async function listAll(client: NotionClient, kind: "page" | "database"): Promise<Obj[]> {
  const out: Obj[] = [];
  let cursor: string | undefined;
  do {
    const r = await client.search(kind, cursor);
    out.push(...r.results);
    cursor = r.has_more ? (r.next_cursor ?? undefined) : undefined;
  } while (cursor);
  return out;
}

/** 루트 아래 객체들의 경로 계산 */
async function buildPaths(client: NotionClient, rootId: string, rootPath: string, objs: Map<string, Obj>) {
  const parentIds = new Map<string, string | null>();
  const blockCache = new Map<string, string | null>();
  for (const [id, o] of objs) if (id !== rootId) parentIds.set(id, await parentOf(client, o.parent, blockCache));
  const paths = new Map<string, string | null>([[rootId, rootPath]]);
  const pathOf = (id: string, depth = 0): string | null => {
    if (paths.has(id)) return paths.get(id)!;
    if (depth > 50) return null;
    const pid = parentIds.get(id);
    const o = objs.get(id);
    const pp = pid && objs.has(pid) ? pathOf(pid, depth + 1) : null;
    const r = pp && o ? `${pp}/${seg(pageTitle(o), id)}` : null;
    paths.set(id, r);
    return r;
  };
  for (const id of objs.keys()) pathOf(id);
  return { paths, parentIds };
}

type ScanResult = { jobId?: number; result: "ok" | "aborted" | "offline" | "error"; message?: string; deleted?: number };

export async function runNotionScan(db: Db, sourceId: number, d: NotionSyncDeps): Promise<ScanResult> {
  const src = db.select().from(sources).where(eq(sources.id, sourceId)).get();
  if (!src) return { result: "error", message: "소스 없음" };
  const cfg = (src.config ?? {}) as NotionConfig;
  const settings = getSettings(db);
  const job = db.insert(scanJobs).values({ sourceId: src.id, kind: "full", scopePath: src.rootPath, startedAt: d.now() }).returning().get();
  const fail = (e: unknown): ScanResult => {
    const c = classify(e);
    db.update(sources).set({ status: c.status, lastError: c.message, lastFullScanOk: false }).where(eq(sources.id, src.id)).run();
    db.update(scanJobs).set({ result: c.status === "offline" ? "aborted" : "error", message: c.message }).where(eq(scanJobs.id, job.id)).run();
    return { jobId: job.id, result: c.status === "offline" ? "offline" : "error", message: c.message };
  };
  try {
    const root = await d.client.getPage(cfg.rootId);
    db.update(sources).set({ status: "syncing" }).where(eq(sources.id, src.id)).run();
    const objs = new Map<string, Obj>();
    for (const o of [...(await listAll(d.client, "database")), ...(await listAll(d.client, "page"))]) if (!o.archived && !o.in_trash) objs.set(normId(o.id)!, o);
    objs.set(cfg.rootId, root);
    const { paths, parentIds } = await buildPaths(d.client, cfg.rootId, src.rootPath, objs);

    // 폴더(페이지·DB) 먼저, 얕은 것부터
    const inScope = [...objs.entries()].filter(([id]) => paths.get(id)).sort((a, b) => paths.get(a[0])!.length - paths.get(b[0])!.length);
    const folderRow = new Map<string, number>();
    for (const [id, o] of inScope) folderRow.set(id, upsertCloudFolder(db, src, id, pageTitle(o), paths.get(id)!, ts(o.last_edited_time), job.id));

    let processed = 0;
    let maxEdited = cfg.lastEditedSync ?? 0;
    for (const [id, o] of inScope) {
      if (d.shouldAbort?.()) {
        db.update(scanJobs).set({ result: "aborted", processed }).where(eq(scanJobs.id, job.id)).run();
        db.update(sources).set({ status: "ok" }).where(eq(sources.id, src.id)).run();
        return { jobId: job.id, result: "aborted" };
      }
      maxEdited = Math.max(maxEdited, ts(o.last_edited_time) ?? 0);
      if (o.object !== "page") continue;
      const pid = id === cfg.rootId ? id : parentIds.get(id);
      await processNotionPage(db, src, d.client, o, paths.get(id)!, pid ? (folderRow.get(pid) ?? null) : null, job.id, d.now());
      processed++;
      if (processed % 20 === 0) db.update(scanJobs).set({ processed }).where(eq(scanJobs.id, job.id)).run();
    }
    purgeExcluded(db, settings);
    const deleted = finalizeDeletions(db, src, src.rootPath, job.id, [], d.now(), settings);
    const now = d.now();
    db.update(scanJobs).set({ result: "ok", finishedAt: now, processed }).where(eq(scanJobs.id, job.id)).run();
    patchSourceConfig(db, src.id, { lastEditedSync: maxEdited, rootTitle: pageTitle(root) });
    db.update(sources).set({ status: "ok", lastError: null, lastFullScanAt: now, lastFullScanOk: true }).where(eq(sources.id, src.id)).run();
    return { jobId: job.id, result: "ok", deleted };
  } catch (e) {
    return fail(e);
  }
}

/** 최근 수정된 페이지만 반영한다 (삭제 판단은 전체 확인에서) */
export async function runNotionChanges(db: Db, sourceId: number, d: NotionSyncDeps): Promise<{ result: "ok" | "offline" | "error" | "skipped"; changed?: number; message?: string }> {
  const src = db.select().from(sources).where(eq(sources.id, sourceId)).get();
  if (!src) return { result: "error", message: "소스 없음" };
  const cfg = (src.config ?? {}) as NotionConfig;
  if (!cfg.lastEditedSync) return { result: "skipped" };
  const since = cfg.lastEditedSync - 5 * 60_000; // Notion 수정 시각은 분 단위라 여유를 둔다
  try {
    const recent: Obj[] = [];
    for (const kind of ["database", "page"] as const) {
      let cursor: string | undefined;
      outer: do {
        const r = await d.client.search(kind, cursor);
        for (const o of r.results) {
          if ((ts(o.last_edited_time) ?? 0) < since) break outer;
          recent.push(o);
        }
        cursor = r.has_more ? (r.next_cursor ?? undefined) : undefined;
      } while (cursor);
    }
    // 오래된 것부터 (부모가 먼저 만들어지도록), DB 를 페이지보다 먼저
    recent.sort((a, b) => (a.object === b.object ? Date.parse(a.last_edited_time) - Date.parse(b.last_edited_time) : a.object === "database" ? -1 : 1));
    const cache = new Map<string, string | null>();
    let changed = 0;
    let maxEdited = cfg.lastEditedSync;
    for (const o of recent) {
      if (o.archived || o.in_trash) continue;
      const id = normId(o.id)!;
      maxEdited = Math.max(maxEdited, ts(o.last_edited_time) ?? 0);
      const pid = id === cfg.rootId ? null : await parentOf(d.client, o.parent, cache);
      const parent = pid ? db.select().from(folders).where(and(eq(folders.sourceId, src.id), eq(folders.externalId, pid), eq(folders.state, "ok"))).get() : undefined;
      const path = id === cfg.rootId ? src.rootPath : parent ? `${parent.path}/${seg(pageTitle(o), id)}` : null;
      if (!path) continue; // 루트 밖이거나 부모를 아직 모름 → 다음 전체 확인에서
      upsertCloudFolder(db, src, id, pageTitle(o), path, ts(o.last_edited_time), null);
      if (o.object === "page") {
        const before = db.select({ h: items.contentHash }).from(items).where(and(eq(items.sourceId, src.id), eq(items.externalId, id))).get()?.h;
        await processNotionPage(db, src, d.client, o, path, parent?.id ?? null, null, d.now());
        if (before !== o.last_edited_time) changed++;
      }
    }
    patchSourceConfig(db, src.id, { lastEditedSync: maxEdited });
    if (src.status !== "syncing") db.update(sources).set({ status: "ok", lastError: null }).where(eq(sources.id, src.id)).run();
    return { result: "ok", changed };
  } catch (e) {
    const c = classify(e);
    db.update(sources).set({ status: c.status, lastError: c.message }).where(eq(sources.id, src.id)).run();
    return { result: c.status, message: c.message };
  }
}
