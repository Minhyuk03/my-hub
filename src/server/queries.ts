import { and, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "./db";
import { folders, itemErrors, items, runtime, scanJobs, sources } from "./db/schema";

export type RecentItem = {
  id: number;
  title: string;
  path: string;
  kind: string;
  state: string;
  modifiedAt: number | null;
  sourceName: string;
  sourceKind: string;
  sourceStatus: string;
};

export function recentItems(db: Db, since: number, limit = 60): RecentItem[] {
  return db
    .select({
      id: items.id,
      title: items.title,
      path: items.path,
      kind: items.kind,
      state: items.state,
      modifiedAt: items.modifiedAt,
      sourceName: sources.name,
      sourceKind: sources.kind,
      sourceStatus: sources.status,
    })
    .from(items)
    .innerJoin(sources, eq(sources.id, items.sourceId))
    .where(and(ne(items.state, "deleted"), gte(items.modifiedAt, since)))
    .orderBy(desc(items.modifiedAt))
    .limit(limit)
    .all();
}

/** 최근 수정이 많은 폴더 (프로젝트 기능 전까지 "이어서 작업하기"로 사용) */
export function activeFolders(db: Db, since: number, limit = 6) {
  return db
    .select({
      folderId: folders.id,
      path: folders.path,
      name: folders.name,
      sourceName: sources.name,
      count: sql<number>`count(*)`,
      last: sql<number>`max(${items.modifiedAt})`,
    })
    .from(items)
    .innerJoin(folders, eq(folders.id, items.folderId))
    .innerJoin(sources, eq(sources.id, items.sourceId))
    .where(and(ne(items.state, "deleted"), gte(items.modifiedAt, since)))
    .groupBy(folders.id)
    .orderBy(sql`count(*) desc`, sql`max(${items.modifiedAt}) desc`)
    .limit(limit)
    .all();
}

export function sourcesWithStats(db: Db) {
  const counts = db
    .select({ sourceId: items.sourceId, state: items.state, n: sql<number>`count(*)` })
    .from(items)
    .groupBy(items.sourceId, items.state)
    .all();
  const running = db.select().from(scanJobs).where(eq(scanJobs.result, "running")).all();
  const errs = db
    .select({ sourceId: items.sourceId, n: sql<number>`count(*)` })
    .from(itemErrors)
    .innerJoin(items, eq(items.id, itemErrors.itemId))
    .groupBy(items.sourceId)
    .all();
  return db
    .select()
    .from(sources)
    .orderBy(sources.id)
    .all()
    .map((s) => {
      const byState: Record<string, number> = {};
      for (const c of counts.filter((c) => c.sourceId === s.id)) byState[c.state] = c.n;
      const job = running.find((j) => j.sourceId === s.id);
      return {
        ...s,
        byState,
        total: Object.entries(byState).filter(([k]) => k !== "deleted").reduce((a, [, n]) => a + n, 0),
        job: job ? { processed: job.processed, total: job.totalEstimate, scope: job.scopePath, startedAt: job.startedAt } : null,
        errorCount: errs.find((e) => e.sourceId === s.id)?.n ?? 0,
      };
    });
}

export function errorList(db: Db, sourceId?: number, limit = 100) {
  return db
    .select({
      itemId: itemErrors.itemId,
      kind: itemErrors.kind,
      message: itemErrors.message,
      retryCount: itemErrors.retryCount,
      nextRetryAt: itemErrors.nextRetryAt,
      updatedAt: itemErrors.updatedAt,
      title: items.title,
      path: items.path,
      sourceId: items.sourceId,
    })
    .from(itemErrors)
    .innerJoin(items, eq(items.id, itemErrors.itemId))
    .where(sourceId ? eq(items.sourceId, sourceId) : undefined)
    .orderBy(desc(itemErrors.updatedAt))
    .limit(limit)
    .all();
}

export type WorkerStatus = { alive: boolean; pid?: number; updatedAt?: number; queued?: number; startedAt?: number };

export function workerStatus(db: Db): WorkerStatus {
  const row = db.select().from(runtime).where(eq(runtime.key, "worker")).get();
  if (!row) return { alive: false };
  const v = row.value as { pid?: number; queued?: number; startedAt?: number };
  return { alive: !!v.pid && Date.now() - row.updatedAt < 15_000, pid: v.pid, updatedAt: row.updatedAt, queued: v.queued, startedAt: v.startedAt };
}

export function getItem(db: Db, id: number) {
  const row = db
    .select({ item: items, source: sources })
    .from(items)
    .innerJoin(sources, eq(sources.id, items.sourceId))
    .where(eq(items.id, id))
    .get();
  if (!row) return null;
  const text = db.$client.prepare(`SELECT body FROM item_text WHERE item_id = ?`).get(id) as { body: string } | undefined;
  const tagNames = db.$client
    .prepare(`SELECT g.name FROM item_tags it JOIN tags g ON g.id = it.tag_id WHERE it.item_id = ? ORDER BY g.name`)
    .pluck()
    .all(id) as string[];
  const error = db.select().from(itemErrors).where(eq(itemErrors.itemId, id)).get();
  return { ...row, body: text?.body ?? "", tags: tagNames, error };
}

export function allTags(db: Db, limit = 200) {
  return db.$client
    .prepare(
      `SELECT g.name, count(*) AS n FROM tags g JOIN item_tags it ON it.tag_id = g.id JOIN items i ON i.id = it.item_id
       WHERE i.state != 'deleted' GROUP BY g.id ORDER BY n DESC LIMIT ?`,
    )
    .all(limit) as { name: string; n: number }[];
}

export function itemsByIds(db: Db, ids: number[]) {
  if (!ids.length) return [];
  return db.select().from(items).where(inArray(items.id, ids)).all();
}
