import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db";
import { folders, projectFolders, projectItems, projects, sources, type AddedBy, type ProjectStatus } from "../db/schema";

type Project = typeof projects.$inferSelect;

export function createProject(db: Db, name: string, opts: { memo?: string; status?: ProjectStatus } = {}): Project {
  const clean = name.trim().normalize("NFC");
  if (!clean) throw new Error("프로젝트 이름을 입력하세요.");
  const now = Date.now();
  return db
    .insert(projects)
    .values({ name: clean, memo: opts.memo ?? "", status: opts.status ?? "active", createdAt: now, updatedAt: now })
    .returning()
    .get();
}

export function updateProject(db: Db, id: number, patch: Partial<Pick<Project, "name" | "memo" | "status">>) {
  const p = { ...patch, updatedAt: Date.now() };
  if (p.name !== undefined) {
    p.name = p.name.trim().normalize("NFC");
    if (!p.name) throw new Error("프로젝트 이름을 입력하세요.");
  }
  db.update(projects).set(p).where(eq(projects.id, id)).run();
}

export function deleteProject(db: Db, id: number) {
  // 연결 정보만 지운다. 실제 파일·폴더는 건드리지 않는다.
  db.delete(projects).where(eq(projects.id, id)).run();
}

export function linkFolder(db: Db, projectId: number, folderId: number, opts: { includeSubfolders?: boolean; addedBy?: AddedBy } = {}) {
  db.insert(projectFolders)
    .values({ projectId, folderId, includeSubfolders: opts.includeSubfolders ?? true, addedBy: opts.addedBy ?? "user", createdAt: Date.now() })
    .onConflictDoUpdate({ target: [projectFolders.projectId, projectFolders.folderId], set: { includeSubfolders: opts.includeSubfolders ?? true } })
    .run();
  touch(db, projectId);
}

export function unlinkFolder(db: Db, projectId: number, folderId: number) {
  db.delete(projectFolders).where(and(eq(projectFolders.projectId, projectId), eq(projectFolders.folderId, folderId))).run();
  touch(db, projectId);
}

export function setFolderSubfolders(db: Db, projectId: number, folderId: number, include: boolean) {
  db.update(projectFolders).set({ includeSubfolders: include }).where(and(eq(projectFolders.projectId, projectId), eq(projectFolders.folderId, folderId))).run();
}

/** 개별 항목 추가(include) 또는 폴더 안 항목 제외(exclude) */
export function setItemRule(db: Db, projectId: number, itemId: number, mode: "include" | "exclude", addedBy: AddedBy = "user") {
  db.insert(projectItems)
    .values({ projectId, itemId, mode, addedBy, createdAt: Date.now() })
    .onConflictDoUpdate({ target: [projectItems.projectId, projectItems.itemId], set: { mode } })
    .run();
  touch(db, projectId);
}

export function clearItemRule(db: Db, projectId: number, itemId: number) {
  db.delete(projectItems).where(and(eq(projectItems.projectId, projectId), eq(projectItems.itemId, itemId))).run();
}

function touch(db: Db, projectId: number) {
  db.update(projects).set({ updatedAt: Date.now() }).where(eq(projects.id, projectId)).run();
}

/**
 * 프로젝트에 속한 항목 ID를 고르는 SQL 조각.
 * = 연결된 폴더 안의 항목(하위 폴더 포함 여부 반영) + 개별 추가 항목 − 제외 항목
 * 폴더 경로는 folders 테이블의 현재 경로를 쓰므로, 폴더가 옮겨져도 새 경로 기준으로 계산된다.
 */
export function membershipSql(db: Db, projectId: number): { sql: string; params: unknown[] } {
  const links = db
    .select({ id: folders.id, path: folders.path, inc: projectFolders.includeSubfolders })
    .from(projectFolders)
    .innerJoin(folders, eq(folders.id, projectFolders.folderId))
    .where(eq(projectFolders.projectId, projectId))
    .all();
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const l of links) {
    if (l.inc) {
      // 경로 범위 비교: "폴더/" 로 시작하는 모든 경로 ('/' 다음 문자가 '0')
      parts.push(`SELECT id FROM items WHERE path > ? AND path < ?`);
      params.push(l.path + "/", l.path + "0");
    } else {
      parts.push(`SELECT id FROM items WHERE folder_id = ?`);
      params.push(l.id);
    }
  }
  parts.push(`SELECT item_id AS id FROM project_items WHERE project_id = ? AND mode = 'include'`);
  params.push(projectId);
  return {
    sql: `SELECT id FROM (${parts.join(" UNION ")}) WHERE id NOT IN (SELECT item_id FROM project_items WHERE project_id = ? AND mode = 'exclude')`,
    params: [...params, projectId],
  };
}

export type ProjectItemRow = {
  id: number;
  title: string;
  path: string;
  kind: string;
  state: string;
  noContentReason: string | null;
  modifiedAt: number | null;
  sourceId: number;
  sourceName: string;
  sourceKind: string;
  sourceStatus: string;
  rule: "include" | "exclude" | null;
};

export function projectItemList(db: Db, projectId: number, opts: { sourceIds?: number[]; since?: number; limit?: number; offset?: number } = {}) {
  const m = membershipSql(db, projectId);
  const where = [`i.state != 'deleted'`];
  const params: unknown[] = [...m.params];
  if (opts.sourceIds?.length) {
    where.push(`i.source_id IN (${opts.sourceIds.map(() => "?").join(",")})`);
    params.push(...opts.sourceIds);
  }
  if (opts.since) {
    where.push(`i.modified_at >= ?`);
    params.push(opts.since);
  }
  const sql = `
    SELECT i.id, i.title, i.path, i.kind, i.state, i.no_content_reason AS noContentReason, i.modified_at AS modifiedAt,
           i.source_id AS sourceId, s.name AS sourceName, s.kind AS sourceKind, s.status AS sourceStatus,
           (SELECT mode FROM project_items pi WHERE pi.project_id = ? AND pi.item_id = i.id) AS rule,
           count(*) OVER () AS total
    FROM items i JOIN sources s ON s.id = i.source_id
    WHERE i.id IN (${m.sql}) AND ${where.join(" AND ")}
    ORDER BY i.modified_at DESC
    LIMIT ? OFFSET ?`;
  const rows = db.$client.prepare(sql).all(projectId, ...params, opts.limit ?? 200, opts.offset ?? 0) as (ProjectItemRow & { total: number })[];
  return { items: rows, total: rows[0]?.total ?? 0 };
}

/** 폴더 연결 목록 + 상태 경고 (폴더 없음, 소스 오프라인) */
export function projectFolderList(db: Db, projectId: number) {
  return db
    .select({
      folderId: folders.id,
      path: folders.path,
      name: folders.name,
      state: folders.state,
      includeSubfolders: projectFolders.includeSubfolders,
      addedBy: projectFolders.addedBy,
      sourceId: sources.id,
      sourceName: sources.name,
      sourceKind: sources.kind,
      sourceStatus: sources.status,
    })
    .from(projectFolders)
    .innerJoin(folders, eq(folders.id, projectFolders.folderId))
    .innerJoin(sources, eq(sources.id, folders.sourceId))
    .where(eq(projectFolders.projectId, projectId))
    .all()
    .map((f) => ({
      ...f,
      warning: f.state === "deleted" ? "폴더 없음 (삭제되었거나 찾을 수 없음)" : f.sourceStatus === "offline" ? "소스 오프라인" : null,
    }));
}

export function excludedItems(db: Db, projectId: number) {
  return db.$client
    .prepare(
      `SELECT i.id, i.title, i.path FROM project_items pi JOIN items i ON i.id = pi.item_id WHERE pi.project_id = ? AND pi.mode = 'exclude' ORDER BY i.title`,
    )
    .all(projectId) as { id: number; title: string; path: string }[];
}

/** 이 항목이 속한 프로젝트 */
export function projectsForItem(db: Db, itemId: number): { id: number; name: string; via: "folder" | "item" }[] {
  const out: { id: number; name: string; via: "folder" | "item" }[] = [];
  for (const p of db.select().from(projects).all()) {
    const m = membershipSql(db, p.id);
    const hit = db.$client.prepare(`SELECT 1 FROM (${m.sql}) WHERE id = ?`).get(...m.params, itemId);
    if (!hit) continue;
    const rule = db.select().from(projectItems).where(and(eq(projectItems.projectId, p.id), eq(projectItems.itemId, itemId))).get();
    out.push({ id: p.id, name: p.name, via: rule?.mode === "include" ? "item" : "folder" });
  }
  return out;
}

export function projectList(db: Db, status?: ProjectStatus) {
  const rows = db
    .select()
    .from(projects)
    .where(status ? eq(projects.status, status) : undefined)
    .orderBy(desc(projects.updatedAt))
    .all();
  const now = Date.now();
  return rows.map((p) => {
    const recent = projectItemList(db, p.id, { since: now - 14 * 86400_000, limit: 1 });
    const all = projectItemList(db, p.id, { limit: 1 });
    const folderCount = db.select({ id: projectFolders.id }).from(projectFolders).where(eq(projectFolders.projectId, p.id)).all().length;
    return { ...p, itemCount: all.total, recentCount: recent.total, lastModified: all.items[0]?.modifiedAt ?? null, folderCount };
  });
}

/** 홈 "이어서 작업하기": 최근 2주 수정이 많은 진행중 프로젝트 */
export function activeProjects(db: Db, limit = 5) {
  return projectList(db, "active")
    .filter((p) => p.recentCount > 0)
    .sort((a, b) => b.recentCount - a.recentCount || (b.lastModified ?? 0) - (a.lastModified ?? 0))
    .slice(0, limit);
}

/** 폴더 이름으로 연결할 폴더 찾기 (프로젝트 화면의 "폴더 연결") */
export function findFolders(db: Db, query: string, limit = 30) {
  const q = query.trim().normalize("NFC").toLowerCase();
  if (!q) return [];
  return db
    .select({ id: folders.id, path: folders.path, name: folders.name, sourceName: sources.name, sourceKind: sources.kind })
    .from(folders)
    .innerJoin(sources, eq(sources.id, folders.sourceId))
    .where(eq(folders.state, "ok"))
    .all()
    .filter((f) => f.name.toLowerCase().includes(q) || f.path.normalize("NFC").toLowerCase().includes(q))
    .sort((a, b) => a.path.length - b.path.length)
    .slice(0, limit);
}

export function projectsByIds(db: Db, ids: number[]) {
  return ids.length ? db.select().from(projects).where(inArray(projects.id, ids)).all() : [];
}
