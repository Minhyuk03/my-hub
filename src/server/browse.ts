/**
 * 허브 파일 탐색 (/hub): 소스별 폴더 나무, 위치(폴더·소스·분류·태그·최근)별 파일 목록.
 * 폴더의 부모는 경로로 정한다 (folders 에 부모 열이 없음). 폴더 1~2천 개 정도라 한 번에 읽는다.
 */
import path from "node:path";
import type { Db } from "./db";
import { CATEGORIES, type Category } from "./category-labels";
import { nfc } from "./search/text";

export type TreeNode = { id: number; sourceId: number; name: string; parentId: number | null; direct: number; total: number };
export type SourceRoot = { id: number; name: string; kind: string; status: string; rootFolderId: number | null; total: number };

/** 소스별 폴더 나무 (부모·바로 든 파일 수·하위 포함 파일 수) */
export function folderTree(db: Db): { sources: SourceRoot[]; nodes: TreeNode[] } {
  const srcs = db.$client
    .prepare(`SELECT id, name, kind, status, root_path AS root FROM sources WHERE enabled = 1 ORDER BY id`)
    .all() as { id: number; name: string; kind: string; status: string; root: string }[];
  const rows = db.$client.prepare(`SELECT id, source_id AS sourceId, path, name FROM folders WHERE state = 'ok'`).all() as { id: number; sourceId: number; path: string; name: string }[];
  const counts = new Map(
    (db.$client.prepare(`SELECT folder_id AS id, count(*) AS n FROM items WHERE state != 'deleted' AND folder_id IS NOT NULL GROUP BY folder_id`).all() as { id: number; n: number }[]).map((r) => [r.id, r.n]),
  );
  // 폴더 없이 소스 맨 위에 있는 파일은 그 소스의 맨 위 폴더에 센다
  const loose = new Map(
    (db.$client.prepare(`SELECT source_id AS id, count(*) AS n FROM items WHERE state != 'deleted' AND folder_id IS NULL GROUP BY source_id`).all() as { id: number; n: number }[]).map((r) => [r.id, r.n]),
  );
  const byPath = new Map(rows.map((r) => [`${r.sourceId}\u0000${r.path}`, r]));
  const rootOf = new Map(srcs.map((s) => [s.id, byPath.get(`${s.id}\u0000${s.root}`)?.id ?? null]));
  const nodes: TreeNode[] = rows.map((r) => {
    const isRoot = rootOf.get(r.sourceId) === r.id;
    const parent = isRoot ? null : (byPath.get(`${r.sourceId}\u0000${path.dirname(r.path)}`)?.id ?? null);
    return { id: r.id, sourceId: r.sourceId, name: r.name, parentId: parent, direct: (counts.get(r.id) ?? 0) + (isRoot ? (loose.get(r.sourceId) ?? 0) : 0), total: 0 };
  });
  // 하위 포함 개수: 자식부터 부모로 더해 올린다
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const depth = (n: TreeNode) => {
    let d = 0;
    for (let p = n.parentId; p != null && d < 200; p = byId.get(p)?.parentId ?? null) d++;
    return d;
  };
  for (const n of nodes) n.total = n.direct;
  for (const n of [...nodes].sort((a, b) => depth(b) - depth(a))) if (n.parentId != null) byId.get(n.parentId)!.total += n.total;
  // 소스 맨 위 폴더 아래 폴더만 남긴다 (소스 밖의 폴더 기록은 나무에 안 넣음)
  const inTree = nodes.filter((n) => n.parentId != null || rootOf.get(n.sourceId) === n.id);
  return {
    sources: srcs.map((s) => {
      const rootId = rootOf.get(s.id) ?? null;
      return { id: s.id, name: s.name, kind: s.kind, status: s.status, rootFolderId: rootId, total: rootId ? (byId.get(rootId)?.total ?? 0) : 0 };
    }),
    nodes: inTree.sort((a, b) => a.name.localeCompare(b.name, "ko")),
  };
}

export type Place =
  | { kind: "recent" }
  | { kind: "folder"; id: number }
  | { kind: "category"; category: Category }
  | { kind: "tag"; tag: string };
export type Sort = "date" | "name" | "size";

export type FileRow = {
  id: number;
  title: string;
  path: string;
  kind: string;
  ext: string;
  size: number;
  state: string;
  category: string | null;
  modifiedAt: number | null;
  sourceKind: string;
  sourceStatus: string;
  noContentReason: string | null;
};

/** 한 위치의 파일 목록. 폴더는 바로 든 파일만 (하위 폴더는 따로 보여 준다), 소스 맨 위 폴더면 폴더 없는 파일도 */
export function listFiles(db: Db, place: Place, opts: { sort?: Sort; limit?: number; offset?: number; since?: number } = {}): { rows: FileRow[]; total: number } {
  const where = [`i.state != 'deleted'`];
  const params: unknown[] = [];
  if (place.kind === "folder") {
    const root = db.$client
      .prepare(`SELECT s.id FROM folders f JOIN sources s ON s.id = f.source_id WHERE f.id = ? AND f.path = s.root_path`)
      .pluck()
      .get(place.id) as number | undefined;
    if (root) {
      where.push(`(i.folder_id = ? OR (i.folder_id IS NULL AND i.source_id = ?))`);
      params.push(place.id, root);
    } else {
      where.push(`i.folder_id = ?`);
      params.push(place.id);
    }
  } else if (place.kind === "category") {
    where.push(`i.category = ?`);
    params.push(place.category);
  } else if (place.kind === "tag") {
    where.push(`i.id IN (SELECT it.item_id FROM v_item_tags it JOIN tags g ON g.id = it.tag_id WHERE g.name = ?)`);
    params.push(nfc(place.tag));
  } else {
    where.push(`i.modified_at >= ?`);
    params.push(opts.since ?? Date.now() - 30 * 86400_000);
  }
  const order = opts.sort === "name" ? `i.title COLLATE NOCASE ASC` : opts.sort === "size" ? `i.size DESC` : `i.modified_at DESC`;
  const rows = db.$client
    .prepare(
      `SELECT i.id, i.title, i.path, i.kind, i.ext, i.size, i.state, i.category, i.modified_at AS modifiedAt, i.no_content_reason AS noContentReason,
              s.kind AS sourceKind, s.status AS sourceStatus, count(*) OVER () AS total
       FROM items i JOIN sources s ON s.id = i.source_id
       WHERE ${where.join(" AND ")} AND s.enabled = 1
       ORDER BY ${order}, i.id
       LIMIT ? OFFSET ?`,
    )
    .all(...params, opts.limit ?? 100, opts.offset ?? 0) as (FileRow & { total: number })[];
  return { rows, total: rows[0]?.total ?? 0 };
}

/** 분류별 파일 수 */
export function categoryCounts(db: Db): Record<Category, number> {
  const out = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  for (const r of db.$client
    .prepare(`SELECT i.category AS c, count(*) AS n FROM items i JOIN sources s ON s.id = i.source_id WHERE i.state != 'deleted' AND s.enabled = 1 GROUP BY i.category`)
    .all() as { c: string; n: number }[])
    if (r.c && r.c in out) out[r.c as Category] = r.n;
  return out;
}

/** 폴더의 위 경로 (소스 맨 위 폴더부터) — 화면 위 경로 표시용 */
export function folderTrail(nodes: TreeNode[], id: number): TreeNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: TreeNode[] = [];
  for (let n = byId.get(id); n && out.length < 200; n = n.parentId != null ? byId.get(n.parentId) : undefined) out.unshift(n);
  return out;
}
