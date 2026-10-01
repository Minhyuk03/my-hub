import { asc, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db";
import { chatCitations, chatMessages, chatThreads, externalLog, items, projects, type ChatScope } from "../db/schema";

export function listThreads(db: Db, limit = 50) {
  return db.select().from(chatThreads).orderBy(desc(chatThreads.updatedAt)).limit(limit).all();
}

export type ThreadView = NonNullable<ReturnType<typeof getThread>>;
export function getThread(db: Db, id: number) {
  const t = db.select().from(chatThreads).where(eq(chatThreads.id, id)).get();
  if (!t) return null;
  const msgs = db.select().from(chatMessages).where(eq(chatMessages.threadId, id)).orderBy(asc(chatMessages.id)).all();
  const ids = msgs.map((m) => m.id);
  const cites = ids.length ? db.select().from(chatCitations).where(inArray(chatCitations.messageId, ids)).orderBy(asc(chatCitations.n)).all() : [];
  return {
    ...t,
    messages: msgs.map((m) => ({ ...m, citations: cites.filter((c) => c.messageId === m.id) })),
  };
}

export function deleteThread(db: Db, id: number) {
  db.delete(chatThreads).where(eq(chatThreads.id, id)).run();
}

/** 범위 표시 이름 */
export function scopeLabel(db: Db, scope: ChatScope): { label: string; items?: { id: number; title: string }[] } {
  if (scope.kind === "all") return { label: "허브 전체" };
  if (scope.kind === "project") {
    const p = db.select({ name: projects.name }).from(projects).where(eq(projects.id, scope.projectId)).get();
    return { label: `프로젝트: ${p?.name ?? "(삭제됨)"}` };
  }
  const list = scope.itemIds.length ? db.select({ id: items.id, title: items.title }).from(items).where(inArray(items.id, scope.itemIds)).all() : [];
  return { label: `선택한 문서 ${list.length}개`, items: list };
}

export function externalLogList(db: Db, limit = 200) {
  const rows = db.select().from(externalLog).orderBy(desc(externalLog.id)).limit(limit).all();
  const ids = [...new Set(rows.flatMap((r) => r.itemIds))];
  const titles = new Map(ids.length ? db.select({ id: items.id, title: items.title }).from(items).where(inArray(items.id, ids)).all().map((r) => [r.id, r.title]) : []);
  return rows.map((r) => ({ ...r, items: r.itemIds.map((id) => ({ id, title: titles.get(id) ?? "(삭제된 항목)" })) }));
}
