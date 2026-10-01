/**
 * 외부 AI 전송 정책 (6장, 서버에서 강제)
 * - 금지는 소스(sources.config.externalAi) · 폴더(external_deny, 하위 전체) · 프로젝트(projects.external_policy) · 항목(external_deny) 단위로 지정한다.
 * - 가장 엄격한 정책: 어느 단계에서든 금지가 하나라도 걸리면 금지. "허용"으로 금지를 풀 수는 없다.
 * - 파생 데이터(조각·요약·인용·채팅 답변)는 원본 항목 ID 로 판단하므로 같은 정책을 따른다.
 * - 로컬 AI 에는 금지 항목도 쓸 수 있다. 이 판단은 Claude·OpenAI 로 보낼 때만 쓴다.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "../db";
import { externalDeny, folders, items, projects, sources } from "../db/schema";
import { membershipSql } from "../projects";
import { patchSourceConfig } from "../connectors/common";

export type DenyReason = { kind: "source" | "folder" | "project" | "item"; id: number; name: string };

/** 주어진 항목 중 외부 전송 금지인 것 */
export function deniedItems(db: Db, itemIds: number[]): Set<number> {
  const ids = [...new Set(itemIds)];
  const out = new Set<number>();
  if (!ids.length) return out;
  for (const [id] of explain(db, ids)) out.add(id);
  return out;
}

/** 항목별 금지 이유 (금지가 아닌 항목은 결과에 없다) */
export function explain(db: Db, itemIds: number[]): Map<number, DenyReason[]> {
  const c = db.$client;
  const out = new Map<number, DenyReason[]>();
  const add = (id: number, r: DenyReason) => {
    const l = out.get(id) ?? [];
    l.push(r);
    out.set(id, l);
  };
  const ids = [...new Set(itemIds)];
  // SQLite 변수 개수 제한을 피하려고 나눠서 확인한다
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500);
    const ph = part.map(() => "?").join(",");
    // 1) 소스
    for (const r of c
      .prepare(
        `SELECT i.id, s.id AS sid, s.name FROM items i JOIN sources s ON s.id = i.source_id
         WHERE i.id IN (${ph}) AND json_extract(s.config, '$.externalAi') = 'deny'`,
      )
      .all(...part) as { id: number; sid: number; name: string }[])
      add(r.id, { kind: "source", id: r.sid, name: r.name });
    // 2) 항목
    for (const r of c.prepare(`SELECT target_id AS id FROM external_deny WHERE target_kind = 'item' AND target_id IN (${ph})`).all(...part) as { id: number }[])
      add(r.id, { kind: "item", id: r.id, name: "이 항목" });
    // 3) 폴더 (하위 전체, Notion 처럼 폴더와 같은 경로의 문서 포함)
    const fl = c
      .prepare(`SELECT f.id, f.path, f.name FROM external_deny d JOIN folders f ON f.id = d.target_id WHERE d.target_kind = 'folder'`)
      .all() as { id: number; path: string; name: string }[];
    for (const f of fl)
      for (const r of c
        .prepare(`SELECT id FROM items WHERE id IN (${ph}) AND ((path > ? AND path < ?) OR path = ?)`)
        .all(...part, f.path + "/", f.path + "0", f.path) as { id: number }[])
        add(r.id, { kind: "folder", id: f.id, name: f.name });
    // 4) 프로젝트 (여러 프로젝트에 속하면 하나라도 금지면 금지)
    for (const p of db.select().from(projects).where(eq(projects.externalPolicy, "deny")).all()) {
      const m = membershipSql(db, p.id);
      for (const r of c.prepare(`SELECT id FROM items WHERE id IN (${ph}) AND id IN (${m.sql})`).all(...part, ...m.params) as { id: number }[])
        add(r.id, { kind: "project", id: p.id, name: p.name });
    }
  }
  return out;
}

export const reasonLabel = (r: DenyReason) =>
  r.kind === "source" ? `소스 "${r.name}"` : r.kind === "folder" ? `폴더 "${r.name}"` : r.kind === "project" ? `프로젝트 "${r.name}"` : "이 항목";

// ---------- 지정·해제 ----------

export function setFolderDeny(db: Db, folderId: number, deny: boolean) {
  setDeny(db, "folder", folderId, deny);
}
export function setItemDeny(db: Db, itemId: number, deny: boolean) {
  setDeny(db, "item", itemId, deny);
}
function setDeny(db: Db, kind: "folder" | "item", id: number, deny: boolean) {
  if (deny) db.insert(externalDeny).values({ targetKind: kind, targetId: id, createdAt: Date.now() }).onConflictDoNothing().run();
  else db.delete(externalDeny).where(and(eq(externalDeny.targetKind, kind), eq(externalDeny.targetId, id))).run();
}
export function setProjectDeny(db: Db, projectId: number, deny: boolean) {
  db.update(projects).set({ externalPolicy: deny ? "deny" : "allow", updatedAt: Date.now() }).where(eq(projects.id, projectId)).run();
}
export function setSourceDeny(db: Db, sourceId: number, deny: boolean) {
  patchSourceConfig(db, sourceId, { externalAi: deny ? "deny" : "allow" });
}

export function isDirectlyDenied(db: Db, kind: "folder" | "item", id: number) {
  return !!db.select().from(externalDeny).where(and(eq(externalDeny.targetKind, kind), eq(externalDeny.targetId, id))).get();
}

/** 금지 지정 목록 (설정 화면용) */
export function denyList(db: Db) {
  const fl = db
    .select({ id: folders.id, name: folders.name, path: folders.path })
    .from(externalDeny)
    .innerJoin(folders, eq(folders.id, externalDeny.targetId))
    .where(eq(externalDeny.targetKind, "folder"))
    .all();
  const it = db
    .select({ id: items.id, name: items.title, path: items.path })
    .from(externalDeny)
    .innerJoin(items, eq(items.id, externalDeny.targetId))
    .where(eq(externalDeny.targetKind, "item"))
    .all();
  const pr = db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.externalPolicy, "deny")).all();
  const sr = db
    .select({ id: sources.id, name: sources.name, config: sources.config })
    .from(sources)
    .all()
    .filter((s) => s.config.externalAi === "deny");
  return { folders: fl, items: it, projects: pr, sources: sr.map(({ id, name }) => ({ id, name })) };
}
