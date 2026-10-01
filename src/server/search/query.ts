import type { Db } from "../db";
import type { ItemKind } from "../extract";
import { membershipSql } from "../projects";
import { nfc, quote, tokenize } from "./text";

export type SearchFilters = {
  sourceIds?: number[];
  kinds?: ItemKind[];
  /** 이 시각(ms) 이후 수정된 항목만 */
  modifiedAfter?: number;
  tag?: string;
  projectId?: number;
};

export type SearchHit = {
  id: number;
  title: string;
  path: string;
  kind: string;
  ext: string;
  state: string;
  noContentReason: string | null;
  modifiedAt: number | null;
  sourceId: number;
  sourceName: string;
  sourceKind: string;
  sourceStatus: string;
  /** 검색어 주변 본문 조각. 하이라이트 위치는 [시작, 끝] 목록 */
  snippet: string;
  highlights: [number, number][];
};

export type SearchResult = { hits: SearchHit[]; total: number; capped: boolean; tookMs: number; terms: string[] };

const MAX_CANDIDATES = 20_000;

/**
 * B2 방식 키워드 검색
 * - 3글자 이상 단어: trigram 색인 (부분 문자열 일치)
 * - 2글자 단어: bigram 보조 색인
 * - 1글자 단어: 본문 LIKE (느리지만 드묾)
 * 모든 단어가 들어 있는 항목만 (AND). 정렬: 제목에 모두 포함 → 제목에 일부 포함 → 최근 수정 순.
 * 후보가 MAX_CANDIDATES 를 넘으면 그 안에서만 정렬한다 (capped).
 */
export function search(db: Db, query: string, filters: SearchFilters = {}, limit = 30, offset = 0): SearchResult {
  const t0 = performance.now();
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return { hits: [], total: 0, capped: false, tookMs: 0, terms };

  const long = terms.filter((t) => t.length >= 3);
  const two = terms.filter((t) => t.length === 2);
  const one = terms.filter((t) => t.length === 1);
  const parts: string[] = [];
  const params: unknown[] = []; // 후보(CTE) 조건
  const whereParams: unknown[] = []; // 필터 조건
  if (long.length) {
    parts.push(`SELECT rowid AS id FROM items_fts WHERE items_fts MATCH ?`);
    params.push(long.map(quote).join(" AND "));
  }
  if (two.length) {
    parts.push(`SELECT rowid AS id FROM items_bigram WHERE items_bigram MATCH ?`);
    params.push(two.map(quote).join(" AND "));
  }
  for (const t of one) {
    parts.push(`SELECT item_id AS id FROM item_text WHERE title LIKE ? OR path LIKE ? OR body LIKE ?`);
    const like = `%${t}%`;
    params.push(like, like, like);
  }

  const where: string[] = [`i.state != 'deleted'`];
  if (filters.sourceIds?.length) {
    where.push(`i.source_id IN (${filters.sourceIds.map(() => "?").join(",")})`);
    whereParams.push(...filters.sourceIds);
  }
  if (filters.kinds?.length) {
    where.push(`i.kind IN (${filters.kinds.map(() => "?").join(",")})`);
    whereParams.push(...filters.kinds);
  }
  if (filters.modifiedAfter) {
    where.push(`i.modified_at >= ?`);
    whereParams.push(filters.modifiedAfter);
  }
  if (filters.projectId) {
    const m = membershipSql(db, filters.projectId);
    where.push(`i.id IN (${m.sql})`);
    whereParams.push(...m.params);
  }
  if (filters.tag) {
    where.push(`i.id IN (SELECT it.item_id FROM v_item_tags it JOIN tags g ON g.id = it.tag_id WHERE g.name = ?)`);
    whereParams.push(nfc(filters.tag));
  }

  // 1단계: 가벼운 열(items)만으로 정렬·페이지를 정한다. 본문은 읽지 않는다.
  const titleScore = terms.map(() => `(instr(lower(i.title), ?) > 0)`).join(" + ");
  const sqlText = `
    WITH cand AS (${parts.join(" INTERSECT ")} LIMIT ${MAX_CANDIDATES})
    SELECT i.id, i.title, i.path, i.kind, i.ext, i.state, i.no_content_reason AS noContentReason,
           i.modified_at AS modifiedAt, i.source_id AS sourceId,
           s.name AS sourceName, s.kind AS sourceKind, s.status AS sourceStatus,
           (${titleScore}) AS ts, count(*) OVER () AS total
    FROM cand JOIN items i ON i.id = cand.id
    JOIN sources s ON s.id = i.source_id
    WHERE ${where.join(" AND ")}
    ORDER BY (ts = ${terms.length}) DESC, ts DESC, i.modified_at DESC
    LIMIT ? OFFSET ?`;
  type Row = Omit<SearchHit, "snippet" | "highlights"> & { total: number; ts: number };
  const rows = db.$client.prepare(sqlText).all(...params, ...terms, ...whereParams, limit, offset) as Row[];

  // 2단계: 이번 페이지 항목의 본문만 읽어 미리보기 조각을 만든다
  const bodies = new Map<number, string>();
  if (rows.length) {
    const q = db.$client.prepare(`SELECT item_id AS id, substr(body, 1, 200000) AS body FROM item_text WHERE item_id IN (${rows.map(() => "?").join(",")})`);
    for (const b of q.all(...rows.map((r) => r.id)) as { id: number; body: string }[]) bodies.set(b.id, b.body);
  }
  const hits: SearchHit[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    path: row.path,
    kind: row.kind,
    ext: row.ext,
    state: row.state,
    noContentReason: row.noContentReason,
    modifiedAt: row.modifiedAt,
    sourceId: row.sourceId,
    sourceName: row.sourceName,
    sourceKind: row.sourceKind,
    sourceStatus: row.sourceStatus,
    ...makeSnippet(bodies.get(row.id) ?? "", terms),
  }));
  const total = rows[0]?.total ?? 0;
  return { hits, total, capped: total >= MAX_CANDIDATES, tookMs: performance.now() - t0, terms };
}

/** 본문에서 첫 검색어 주변을 잘라 하이라이트 위치와 함께 돌려준다 */
export function makeSnippet(body: string, terms: string[], width = 140): { snippet: string; highlights: [number, number][] } {
  if (!body) return { snippet: "", highlights: [] };
  const lower = body.toLowerCase();
  let first = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (first < 0 || i < first)) first = i;
  }
  const start = Math.max(0, first < 0 ? 0 : first - Math.floor(width / 3));
  let snippet = body.slice(start, start + width).replace(/\s+/g, " ");
  const prefix = start > 0 ? "…" : "";
  snippet = prefix + snippet + (start + width < body.length ? "…" : "");
  const sl = snippet.toLowerCase();
  const highlights: [number, number][] = [];
  for (const t of terms) {
    let i = sl.indexOf(t);
    while (i >= 0) {
      highlights.push([i, i + t.length]);
      i = sl.indexOf(t, i + t.length);
    }
  }
  highlights.sort((a, b) => a[0] - b[0]);
  return { snippet, highlights: mergeRanges(highlights) };
}

function mergeRanges(r: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const x of r) {
    const last = out[out.length - 1];
    if (last && x[0] <= last[1]) last[1] = Math.max(last[1], x[1]);
    else out.push([...x]);
  }
  return out;
}
