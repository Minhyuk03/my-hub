/**
 * 의미 검색과 하이브리드 검색
 * - 의미 검색: 검색어를 bge-m3 로 임베딩 → sqlite-vec 에서 가까운 조각 찾기 → 문서별 가장 가까운 조각으로 묶기
 * - 하이브리드: 키워드 순위와 의미 순위를 RRF(1/(60+순위))로 합친다. 단어가 같으면 키워드가, 뜻이 같으면 의미 검색이 끌어올린다.
 * - 임베딩 모델이 준비되지 않았으면(외장 디스크 분리, Ollama 꺼짐, 처음 불러오는 중) 키워드 결과만 돌려준다.
 */
import type { Db } from "../db";
import type { Ollama } from "../ai/ollama";
import { normalized } from "../ai/chunks";
import { membershipSql } from "../projects";
import { nfc } from "./text";
import { search, type SearchFilters, type SearchHit, type SearchResult } from "./query";

export type HybridResult = SearchResult & { mode: "hybrid" | "keyword" | "semantic"; semanticNote?: string };
const RRF_K = 60;
const MIN_SIM = 0.45;

type SemHit = { itemId: number; sim: number; chunk: string };

/** 의미 검색: 문서별 가장 가까운 조각 */
export function vectorSearch(db: Db, qv: Float32Array, filters: SearchFilters, k = 300): SemHit[] {
  const c = db.$client;
  const rows = c
    .prepare(
      `SELECT v.chunk_id AS id, v.distance AS d, ch.item_id AS itemId, ch.text AS text
       FROM vec_chunks v JOIN item_chunks ch ON ch.id = v.chunk_id
       WHERE v.embedding MATCH ? AND k = ?`,
    )
    .all(qv, k) as { id: number; d: number; itemId: number; text: string }[];
  if (!rows.length) return [];
  // 필터 적용 (키워드 검색과 같은 규칙)
  const ids = [...new Set(rows.map((r) => r.itemId))];
  const where = [`i.id IN (${ids.map(() => "?").join(",")})`, `i.state != 'deleted'`];
  const params: unknown[] = [...ids];
  if (filters.sourceIds?.length) {
    where.push(`i.source_id IN (${filters.sourceIds.map(() => "?").join(",")})`);
    params.push(...filters.sourceIds);
  }
  if (filters.kinds?.length) {
    where.push(`i.kind IN (${filters.kinds.map(() => "?").join(",")})`);
    params.push(...filters.kinds);
  }
  if (filters.modifiedAfter) {
    where.push(`i.modified_at >= ?`);
    params.push(filters.modifiedAfter);
  }
  if (filters.tag) {
    where.push(`i.id IN (SELECT it.item_id FROM v_item_tags it JOIN tags g ON g.id = it.tag_id WHERE g.name = ?)`);
    params.push(nfc(filters.tag));
  }
  if (filters.projectId) {
    const m = membershipSql(db, filters.projectId);
    where.push(`i.id IN (${m.sql})`);
    params.push(...m.params);
  }
  const ok = new Set(c.prepare(`SELECT i.id FROM items i WHERE ${where.join(" AND ")}`).pluck().all(...params) as number[]);
  const best = new Map<number, SemHit>();
  for (const r of rows) {
    if (!ok.has(r.itemId)) continue;
    const sim = 1 - r.d;
    if (sim < MIN_SIM) continue;
    const prev = best.get(r.itemId);
    if (!prev || sim > prev.sim) best.set(r.itemId, { itemId: r.itemId, sim, chunk: r.text });
  }
  return [...best.values()].sort((a, b) => b.sim - a.sim);
}

function hitsByIds(db: Db, ids: number[]): Map<number, Omit<SearchHit, "snippet" | "highlights">> {
  if (!ids.length) return new Map();
  const rows = db.$client
    .prepare(
      `SELECT i.id, i.title, i.path, i.kind, i.ext, i.state, i.no_content_reason AS noContentReason, i.modified_at AS modifiedAt,
              i.source_id AS sourceId, s.name AS sourceName, s.kind AS sourceKind, s.status AS sourceStatus
       FROM items i JOIN sources s ON s.id = i.source_id WHERE i.id IN (${ids.map(() => "?").join(",")})`,
    )
    .all(...ids) as Omit<SearchHit, "snippet" | "highlights">[];
  return new Map(rows.map((r) => [r.id, r]));
}

/** 검색어 임베딩 (모델이 이미 올라와 있으면 수십 ms, 아니면 timeoutMs 안에 못 끝나 키워드만) */
export async function embedQuery(ai: Ollama, model: string, q: string, timeoutMs = 3000): Promise<Float32Array | null> {
  const t = new Promise<null>((r) => setTimeout(() => r(null), timeoutMs));
  const e = ai
    .embed(model, [q])
    .then((v) => normalized(v[0]))
    .catch(() => null);
  return Promise.race([e, t]);
}

export async function hybridSearch(
  db: Db,
  ai: Ollama | null,
  model: string,
  query: string,
  filters: SearchFilters = {},
  limit = 30,
  offset = 0,
  mode: "hybrid" | "keyword" | "semantic" = "hybrid",
): Promise<HybridResult> {
  const t0 = performance.now();
  const kw = mode === "semantic" ? null : search(db, query, filters, 200, 0);
  if (mode === "keyword" || !ai || !query.trim()) {
    const r = search(db, query, filters, limit, offset);
    return { ...r, mode: "keyword" };
  }
  const qv = await embedQuery(ai, model, query);
  if (!qv) {
    const r = search(db, query, filters, limit, offset);
    return { ...r, mode: "keyword", semanticNote: "의미 검색 모델이 준비되지 않아 키워드 결과만 보여줍니다." };
  }
  const sem = vectorSearch(db, qv, filters);
  const score = new Map<number, number>();
  const semBy = new Map(sem.map((s) => [s.itemId, s]));
  kw?.hits.forEach((h, i) => score.set(h.id, (score.get(h.id) ?? 0) + 1 / (RRF_K + i + 1)));
  sem.slice(0, 200).forEach((s, i) => score.set(s.itemId, (score.get(s.itemId) ?? 0) + 1 / (RRF_K + i + 1)));
  const order = [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  const pageIds = order.slice(offset, offset + limit);
  const kwBy = new Map((kw?.hits ?? []).map((h) => [h.id, h]));
  const base = hitsByIds(db, pageIds.filter((id) => !kwBy.has(id)));
  type Hit = SearchHit & { similarity?: number };
  const hits: Hit[] = [];
  for (const id of pageIds) {
    const k = kwBy.get(id);
    const s = semBy.get(id);
    if (k) {
      hits.push({ ...k, similarity: s?.sim });
      continue;
    }
    const b = base.get(id);
    if (!b || !s) continue;
    // 의미로만 찾은 문서: 가장 가까운 조각을 미리보기로
    hits.push({ ...b, snippet: s.chunk.replace(/\s+/g, " ").slice(0, 160) + (s.chunk.length > 160 ? "…" : ""), highlights: [], similarity: s.sim });
  }
  return {
    hits,
    total: order.length,
    capped: kw?.capped ?? false,
    tookMs: performance.now() - t0,
    terms: kw?.terms ?? [],
    mode: mode === "semantic" ? "semantic" : "hybrid",
  };
}
