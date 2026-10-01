import type { Db } from "../db";
import { nfc, toBigrams } from "./text";

/** 본문은 색인에 최대 이만큼만 넣는다 (아주 긴 로그 파일 등) */
export const MAX_BODY_CHARS = 500_000;

export function writeItemText(db: Db, itemId: number, t: { title: string; path: string; body: string }) {
  const title = nfc(t.title);
  const p = nfc(t.path);
  const body = nfc(t.body).slice(0, MAX_BODY_CHARS);
  const c = db.$client;
  // 본문이 바뀌면 의미 검색 조각을 다시 만들도록 표시를 지운다 (조각은 새로 만들 때 교체)
  const old = c.prepare(`SELECT body FROM item_text WHERE item_id = ?`).pluck().get(itemId) as string | undefined;
  if (old !== undefined && old !== body) c.prepare(`DELETE FROM item_chunk_state WHERE item_id = ?`).run(itemId);
  c.prepare(
    `INSERT INTO item_text(item_id, title, path, body) VALUES (?, ?, ?, ?)
     ON CONFLICT(item_id) DO UPDATE SET title = excluded.title, path = excluded.path, body = excluded.body`,
  ).run(itemId, title, p, body);
  c.prepare(`DELETE FROM items_bigram WHERE rowid = ?`).run(itemId);
  c.prepare(`INSERT INTO items_bigram(rowid, grams) VALUES (?, ?)`).run(itemId, toBigrams(`${title} ${p} ${body}`));
}

export function removeItemText(db: Db, itemId: number) {
  db.$client.prepare(`DELETE FROM item_text WHERE item_id = ?`).run(itemId);
  db.$client.prepare(`DELETE FROM items_bigram WHERE rowid = ?`).run(itemId);
  removeChunks(db, itemId);
}

/** 의미 검색 조각과 벡터 지우기 */
export function removeChunks(db: Db, itemId: number) {
  const c = db.$client;
  c.prepare(`DELETE FROM vec_chunks WHERE chunk_id IN (SELECT id FROM item_chunks WHERE item_id = ?)`).run(itemId);
  c.prepare(`DELETE FROM item_chunks WHERE item_id = ?`).run(itemId);
  c.prepare(`DELETE FROM item_chunk_state WHERE item_id = ?`).run(itemId);
}
