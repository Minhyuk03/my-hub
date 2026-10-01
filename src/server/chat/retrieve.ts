/**
 * 채팅 근거 자료 찾기
 * - search: 질문으로 의미 검색(조각 단위) + 키워드 검색을 합쳐(RRF) 좋은 조각을 고른다.
 * - recent: 범위 안에서 최근 수정한 문서의 앞부분 (프로젝트 현황 정리 등)
 * - whole: 고른 문서들의 본문을 앞에서부터 (요약 등)
 * 결과의 strong 이 false 면 근거가 약한 것 → AI 를 부르지 않고 "근거가 부족합니다".
 */
import type { Db } from "../db";
import type { ChatScope } from "../db/schema";
import type { Ollama } from "../ai/ollama";
import { cloudPathLabel } from "../connectors/common";
import { membershipSql } from "../projects";
import { embedQuery } from "../search/semantic";
import { search, type SearchFilters } from "../search/query";
import type { GatewayContext } from "./gateway";

export type Strategy = "search" | "recent" | "whole";
export type Retrieved = { contexts: GatewayContext[]; strong: boolean; semantic: boolean };
export type RetrieveOpts = { maxContexts?: number; maxChars?: number; perItem?: number; strategy?: Strategy; embedTimeoutMs?: number };

const RRF_K = 60;
/** 이 정도 이상 비슷한 조각이 하나라도 있어야 "근거 있음" */
export const STRONG_SIM = 0.55;
const MIN_SIM = 0.45;
const EXCERPT = 900;

type Cand = { itemId: number; chunkId: number | null; text: string; score: number; sim?: number };
type ItemInfo = { id: number; title: string; path: string; modifiedAt: number | null; root: string; sourceName: string };

const STOP = new Set(["설명", "설명해", "알려", "정리", "요약", "단계별", "단계별로", "자세히", "간단히", "어떤", "어떻게", "무엇", "뭐", "뭐야", "뭐지", "언제", "어디", "누가", "왜", "있어", "있나", "있는지", "해줘", "줘", "좀", "대해", "대해서", "관련", "관련된", "내용", "the", "what", "how", "is", "are"]);
const ENDING = /(해\s*줘|해\s*줄래|해\s*주세요|알려\s*줘|줘|줄래|주세요|인가요|일까|이야|야|니|나요|까요|어|돼|됐어|했어|하나|해)$/;
const JOSA = /(에서는|에서|으로|에게|까지|부터|이라|라고|하고|와는|과는|이랑|은|는|이|가|을|를|의|에|로|와|과|도|만)$/;

/** 질문 문장에서 검색어만 남긴다: "리눅스 부팅 과정을 설명해줘" → "리눅스 부팅 과정" (키워드 검색은 모든 낱말이 있어야 찾으므로) */
export function keywordQuery(question: string): string {
  const out: string[] = [];
  for (let w of question.normalize("NFC").replace(/[?？!！.,，。~"'“”‘’()]/g, " ").split(/\s+/)) {
    if (!w) continue;
    if (/[가-힣]$/.test(w)) {
      w = w.replace(ENDING, "");
      if (w.length >= 3 || /[가-힣]{2}(을|를|은|는|이|가|의|에|로|와|과|도)$/.test(w)) w = w.replace(JOSA, "");
    }
    if (!w || STOP.has(w.toLowerCase())) continue;
    out.push(w);
  }
  return out.length ? out.join(" ") : question;
}

/** 범위 안의 항목 ID (전체면 null = 제한 없음) */
export function scopeItemIds(db: Db, scope: ChatScope): Set<number> | null {
  if (scope.kind === "all") return null;
  if (scope.kind === "items") return new Set(scope.itemIds);
  const m = membershipSql(db, scope.projectId);
  return new Set(db.$client.prepare(`SELECT i.id FROM items i WHERE i.state != 'deleted' AND i.id IN (${m.sql})`).pluck().all(...m.params) as number[]);
}

function infos(db: Db, ids: number[]): Map<number, ItemInfo> {
  if (!ids.length) return new Map();
  const rows = db.$client
    .prepare(`SELECT i.id, i.title, i.path, i.modified_at AS modifiedAt, s.root_path AS root, s.name AS sourceName FROM items i JOIN sources s ON s.id = i.source_id WHERE i.id IN (${ids.map(() => "?").join(",")})`)
    .all(...ids) as ItemInfo[];
  return new Map(rows.map((r) => [r.id, r]));
}

/** AI 에게 주는 위치: "소스 이름/소스 안 경로" (내 Mac 의 전체 경로는 보내지 않는다) */
export function displayPath(it: { path: string; root: string; sourceName: string }) {
  if (/^[a-z]+:\//.test(it.path)) return cloudPathLabel(it.path).normalize("NFC");
  const rel = it.path.startsWith(it.root + "/") ? it.path.slice(it.root.length + 1) : it.path.split("/").pop()!;
  return `${it.sourceName}/${rel}`.normalize("NFC");
}

const vecOf = (b: Buffer) => new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/** 문서의 조각들 중 질문과 가장 가까운 것 (조각이 없으면 null) */
function bestChunkOf(db: Db, itemId: number, qv: Float32Array | null): { id: number; text: string; sim: number } | null {
  const c = db.$client;
  const chunks = c.prepare(`SELECT id, text FROM item_chunks WHERE item_id = ? ORDER BY idx`).all(itemId) as { id: number; text: string }[];
  if (!chunks.length) return null;
  if (!qv) return { ...chunks[0], sim: 0 };
  let best = { ...chunks[0], sim: -1 };
  const get = c.prepare(`SELECT embedding FROM vec_chunks WHERE chunk_id = ?`);
  for (const ch of chunks) {
    const e = get.pluck().get(BigInt(ch.id)) as Buffer | undefined;
    if (!e) continue;
    const s = dot(qv, vecOf(e));
    if (s > best.sim) best = { ...ch, sim: s };
  }
  return best;
}

/** 본문에서 검색어 주변 (조각이 아직 없는 문서용) */
function excerpt(db: Db, itemId: number, terms: string[]): string {
  const body = (db.$client.prepare(`SELECT body FROM item_text WHERE item_id = ?`).pluck().get(itemId) as string | undefined) ?? "";
  if (body.length <= EXCERPT) return body;
  const low = body.toLowerCase();
  let at = -1;
  for (const t of terms) {
    at = low.indexOf(t.toLowerCase());
    if (at >= 0) break;
  }
  const start = Math.max(0, at < 0 ? 0 : at - EXCERPT / 3);
  return body.slice(start, start + EXCERPT);
}

/** 문서 앞부분 조각들 (whole·recent 용) */
function leadingParts(db: Db, itemId: number, n: number): { id: number | null; text: string }[] {
  const chunks = db.$client.prepare(`SELECT id, text FROM item_chunks WHERE item_id = ? ORDER BY idx LIMIT ?`).all(itemId, n) as { id: number; text: string }[];
  if (chunks.length) return chunks;
  const body = (db.$client.prepare(`SELECT body FROM item_text WHERE item_id = ?`).pluck().get(itemId) as string | undefined) ?? "";
  return body.trim() ? [{ id: null, text: body.slice(0, EXCERPT) }] : [];
}

export async function retrieve(db: Db, ai: Ollama | null, embedModel: string, question: string, scope: ChatScope, opts: RetrieveOpts = {}): Promise<Retrieved> {
  const maxContexts = opts.maxContexts ?? 8;
  const maxChars = opts.maxChars ?? 8000;
  const perItem = opts.perItem ?? 3;
  const strategy = opts.strategy ?? "search";
  const allowed = scopeItemIds(db, scope);
  const c = db.$client;
  let cands: Cand[] = [];
  let strong = false;
  let semantic = false;

  if (strategy === "whole" || strategy === "recent") {
    let ids: number[];
    if (strategy === "whole" && scope.kind === "items") ids = scope.itemIds;
    else {
      const where = allowed ? `AND i.id IN (${[...allowed].map(() => "?").join(",") || "NULL"})` : "";
      ids = c
        .prepare(
          `SELECT i.id FROM items i JOIN item_text t ON t.item_id = i.id WHERE i.state = 'ok' AND length(t.body) > 50 ${where} ORDER BY i.modified_at DESC LIMIT ?`,
        )
        .pluck()
        .all(...(allowed ? [...allowed] : []), maxContexts) as number[];
    }
    const per = Math.max(1, Math.min(perItem, Math.floor(maxContexts / Math.max(1, ids.length))));
    ids.forEach((id, rank) => leadingParts(db, id, per).forEach((p, k) => cands.push({ itemId: id, chunkId: p.id, text: p.text, score: 1 / (RRF_K + rank + k + 1) })));
    strong = cands.length > 0;
  } else {
    const qv = ai ? await embedQuery(ai, embedModel, question, opts.embedTimeoutMs ?? 20_000) : null;
    const byChunk = new Map<string, Cand>();
    const key = (x: { itemId: number; chunkId: number | null }) => `${x.itemId}:${x.chunkId ?? "x"}`;
    if (qv) {
      semantic = true;
      const rows = c
        .prepare(
          `SELECT v.chunk_id AS id, v.distance AS d, ch.item_id AS itemId, ch.text AS text
           FROM vec_chunks v JOIN item_chunks ch ON ch.id = v.chunk_id JOIN items i ON i.id = ch.item_id
           WHERE v.embedding MATCH ? AND k = ? AND i.state != 'deleted'`,
        )
        .all(qv, allowed ? 1000 : 200) as { id: number; d: number; itemId: number; text: string }[];
      let rank = 0;
      for (const r of rows) {
        if (allowed && !allowed.has(r.itemId)) continue;
        const sim = 1 - r.d;
        if (sim < MIN_SIM) continue;
        if (sim >= STRONG_SIM) strong = true;
        const cand = { itemId: r.itemId, chunkId: r.id, text: r.text, score: 1 / (RRF_K + ++rank), sim };
        byChunk.set(key(cand), cand);
      }
    }
    const filters: SearchFilters = scope.kind === "project" ? { projectId: scope.projectId } : {};
    const kw = search(db, keywordQuery(question), filters, 40, 0);
    let kr = 0;
    for (const h of kw.hits) {
      if (allowed && !allowed.has(h.id)) continue;
      kr++;
      strong = true;
      const best = bestChunkOf(db, h.id, qv);
      const cand: Cand = best ? { itemId: h.id, chunkId: best.id, text: best.text, score: 0, sim: best.sim } : { itemId: h.id, chunkId: null, text: excerpt(db, h.id, kw.terms), score: 0 };
      const prev = byChunk.get(key(cand)) ?? cand;
      prev.score += 1 / (RRF_K + kr);
      byChunk.set(key(cand), prev);
      if (kr >= 20) break;
    }
    cands = [...byChunk.values()].filter((x) => x.text.trim()).sort((a, b) => b.score - a.score);
  }

  // 문서당 개수·전체 글자 수 제한
  // 같은 문서가 여러 곳에 복사돼 있으면(같은 제목·같은 조각) 하나로 본다
  const info = infos(db, [...new Set(cands.map((p) => p.itemId))]);
  const docKey = (id: number) => (info.get(id)?.title ?? String(id)).normalize("NFC").toLowerCase();
  const picked: Cand[] = [];
  const perCount = new Map<string, number>();
  const seenText = new Set<string>();
  let chars = 0;
  for (const x of cands) {
    if (picked.length >= maxContexts) break;
    const k = docKey(x.itemId);
    const t = x.text.replace(/\s+/g, " ").trim();
    if ((perCount.get(k) ?? 0) >= perItem || seenText.has(t)) continue;
    if (chars + x.text.length > maxChars && picked.length) continue;
    picked.push(x);
    seenText.add(t);
    perCount.set(k, (perCount.get(k) ?? 0) + 1);
    chars += x.text.length;
  }
  const contexts: GatewayContext[] = picked
    .filter((p) => info.has(p.itemId))
    .map((p, i) => {
      const it = info.get(p.itemId)!;
      return { n: i + 1, itemId: p.itemId, chunkId: p.chunkId, title: it.title, path: displayPath(it), modifiedAt: it.modifiedAt, text: p.text };
    });
  return { contexts, strong: strong && contexts.length > 0, semantic };
}
