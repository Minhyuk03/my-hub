/**
 * 중복 파일 찾기 (목록만, 지우거나 옮기지 않는다)
 * - 내용 해시가 같은 파일끼리 묶는다. 로컬·iCloud·외장 디스크·Obsidian 은 SHA-256, Google Drive 는 Drive 가 준 MD5 라
 *   Drive 끼리·로컬끼리만 비교된다. Notion·GitHub 는 해시가 아니라 수정 시각이라 제외.
 * - iCloud 에만 있고 내려받지 않은 파일은 내용 해시가 없어 비교하지 못한다.
 */
import type { Db } from "./db";

const FILE_KINDS = ["external", "icloud", "obsidian", "local", "gdrive"];

export type DupItem = { id: number; title: string; path: string; kind: string; state: string; size: number; modifiedAt: number | null; sourceKind: string; sourceStatus: string; sourceName: string };
export type DupGroup = { hash: string; size: number; count: number; wasted: number; items: DupItem[] };

function where(minSize: number, sourceId?: number) {
  const params: unknown[] = [...FILE_KINDS, minSize];
  let w = `i.state = 'ok' AND i.content_hash IS NOT NULL AND s.kind IN (${FILE_KINDS.map(() => "?").join(",")}) AND i.size >= ?`;
  if (sourceId) {
    w += ` AND i.content_hash IN (SELECT content_hash FROM items WHERE source_id = ? AND state = 'ok')`;
    params.push(sourceId);
  }
  return { w, params };
}

export function duplicateSummary(db: Db, minSize = 1) {
  const { w, params } = where(minSize);
  return db.$client
    .prepare(
      `SELECT count(*) AS groups, coalesce(sum(n - 1), 0) AS extra, coalesce(sum((n - 1) * size), 0) AS wasted FROM (
         SELECT i.content_hash, count(*) AS n, max(i.size) AS size FROM items i JOIN sources s ON s.id = i.source_id WHERE ${w} GROUP BY i.content_hash HAVING n > 1)`,
    )
    .get(...params) as { groups: number; extra: number; wasted: number };
}

export function duplicateGroups(db: Db, opts: { minSize?: number; sourceId?: number; limit?: number; offset?: number } = {}): DupGroup[] {
  const { w, params } = where(opts.minSize ?? 1, opts.sourceId);
  const c = db.$client;
  const groups = c
    .prepare(
      `SELECT i.content_hash AS hash, count(*) AS count, max(i.size) AS size FROM items i JOIN sources s ON s.id = i.source_id
       WHERE ${w} GROUP BY i.content_hash HAVING count > 1 ORDER BY (count - 1) * size DESC, count DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, opts.limit ?? 50, opts.offset ?? 0) as { hash: string; count: number; size: number }[];
  if (!groups.length) return [];
  const rows = c
    .prepare(
      `SELECT i.content_hash AS hash, i.id, i.title, i.path, i.kind, i.state, i.size, i.modified_at AS modifiedAt, s.kind AS sourceKind, s.status AS sourceStatus, s.name AS sourceName
       FROM items i JOIN sources s ON s.id = i.source_id
       WHERE i.state = 'ok' AND i.content_hash IN (${groups.map(() => "?").join(",")}) AND s.kind IN (${FILE_KINDS.map(() => "?").join(",")})
       ORDER BY i.modified_at DESC`,
    )
    .all(...groups.map((g) => g.hash), ...FILE_KINDS) as (DupItem & { hash: string })[];
  return groups.map((g) => ({ ...g, wasted: (g.count - 1) * g.size, items: rows.filter((r) => r.hash === g.hash) }));
}
