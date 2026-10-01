/**
 * 의미 검색용 조각(청크) 만들기
 * - 본문을 약 700자 조각으로 나눈다 (문단 경계 우선, 앞 조각과 100자 겹침).
 * - 조각마다 "제목 + 조각"을 bge-m3 로 임베딩해 sqlite-vec(vec_chunks)에 넣는다.
 * - 데이터 파일·코드가 검색을 독차지하지 않도록 문서당 조각 수에 상한을 둔다.
 */
import crypto from "node:crypto";
import type { Db } from "../db";
import { removeChunks } from "../search/index-writer";
import { EMBED_BATCH, type Ollama } from "./ollama";

export const CHUNK_SIZE = 700;
export const CHUNK_OVERLAP = 100;
/** 종류별 문서당 최대 조각 수 */
export const MAX_CHUNKS: Record<string, number> = { note: 60, document: 40, pdf: 60, code: 8, chat: 80 };
const MIN_BODY = 100;

const sha = (s: string) => crypto.createHash("sha1").update(s).digest("hex");

/** 문단 경계를 살려 나누기 */
export function chunkText(body: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP, max = 60): string[] {
  const text = body.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return [];
  if (text.length <= size) return [text];
  const out: string[] = [];
  let start = 0;
  while (start < text.length && out.length < max) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      // 조각 끝을 문단·문장 경계로 당긴다 (너무 짧아지지 않게 절반 이후에서만)
      const win = text.slice(start + size / 2, end);
      const cut = Math.max(win.lastIndexOf("\n\n"), win.lastIndexOf("\n"), win.lastIndexOf(". "), win.lastIndexOf("다. "));
      if (cut > 0) end = start + size / 2 + cut + 1;
    }
    out.push(text.slice(start, end).trim());
    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return out.filter(Boolean);
}

/** 바뀐(또는 아직 없는) 문서의 조각을 만들어 임베딩. 한 번에 최대 chunkBudget 개 */
export async function runChunks(db: Db, ai: Ollama, model: string, chunkBudget: number): Promise<{ items: number; chunks: number }> {
  const c = db.$client;
  const rows = c
    .prepare(
      // item_chunk_state.created_at 에는 조각을 만들 때의 items.indexed_at 을 넣어 두고, 다르면(다시 색인됨) 확인한다
      `SELECT i.id, i.title, i.kind, t.body, coalesce(i.indexed_at, 0) AS indexedAt FROM items i JOIN item_text t ON t.item_id = i.id LEFT JOIN item_chunk_state s ON s.item_id = i.id
       WHERE i.state = 'ok' AND length(t.body) >= ? AND (s.item_id IS NULL OR s.model != ? OR s.created_at != coalesce(i.indexed_at, 0))
       ORDER BY i.modified_at DESC LIMIT 200`,
    )
    .all(MIN_BODY, model) as { id: number; title: string; kind: string; body: string; indexedAt: number }[];
  let used = 0;
  let done = 0;
  const insChunk = c.prepare(`INSERT INTO item_chunks(item_id, idx, text) VALUES (?, ?, ?)`);
  const insVec = c.prepare(`INSERT INTO vec_chunks(chunk_id, embedding) VALUES (?, ?)`);
  const insState = c.prepare(
    `INSERT INTO item_chunk_state(item_id, model, text_hash, chunks, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET model = excluded.model, text_hash = excluded.text_hash, chunks = excluded.chunks, created_at = excluded.created_at`,
  );
  for (const r of rows) {
    const hash = sha(r.body);
    const prev = c.prepare(`SELECT text_hash, model FROM item_chunk_state WHERE item_id = ?`).get(r.id) as { text_hash: string; model: string } | undefined;
    if (prev && prev.text_hash === hash && prev.model === model) {
      // 본문은 그대로(경로·제목만 바뀜) → 표시만 갱신
      c.prepare(`UPDATE item_chunk_state SET created_at = ? WHERE item_id = ?`).run(r.indexedAt, r.id);
      continue;
    }
    const parts = chunkText(r.body, CHUNK_SIZE, CHUNK_OVERLAP, MAX_CHUNKS[r.kind] ?? 20);
    if (used && used + parts.length > chunkBudget) break;
    const vecs: number[][] = [];
    const inputs = parts.map((p) => `${r.title}\n${p}`);
    for (let i = 0; i < inputs.length; i += EMBED_BATCH) vecs.push(...(await ai.embed(model, inputs.slice(i, i + EMBED_BATCH))));
    db.transaction(() => {
      removeChunks(db, r.id);
      parts.forEach((p, i) => {
        const id = insChunk.run(r.id, i, p).lastInsertRowid;
        insVec.run(BigInt(id), normalized(vecs[i]));
      });
      insState.run(r.id, model, hash, parts.length, r.indexedAt);
    });
    used += parts.length;
    done++;
    if (used >= chunkBudget) break;
  }
  return { items: done, chunks: used };
}

export function normalized(v: number[]): Float32Array {
  const f = new Float32Array(v.length);
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  v.forEach((x, i) => (f[i] = x / n));
  return f;
}
