/**
 * 2026-10-01 정리 (한 번만 실행)
 * 1) 변경 감지가 잘못 추가했다가 deleted 로 표시된 심볼릭 링크 항목을 색인에서 지운다 (실제 파일은 건드리지 않음)
 * 2) iCloud 읽기 거절(-11)로 extract_failed 가 된 항목을 다시 확인하도록 워커에 요청한다 → cloud_only 로 바뀜
 */
import fs from "node:fs";
import { openDb } from "@/server/db";
import { removeItemText } from "@/server/search/index-writer";
import { enqueue } from "@/server/sources/manage";

const db = openDb();
const c = db.$client;
const deleted = c.prepare(`SELECT id, path FROM items WHERE state = 'deleted'`).all() as { id: number; path: string }[];
let removed = 0;
for (const it of deleted) {
  let isLink = false;
  try {
    isLink = fs.lstatSync(it.path).isSymbolicLink();
  } catch {}
  if (!isLink) continue;
  removeItemText(db, it.id);
  for (const t of ["item_tags", "item_links", "item_errors", "project_items"]) c.prepare(`DELETE FROM ${t} WHERE item_id = ?`).run(it.id);
  c.prepare(`DELETE FROM items WHERE id = ?`).run(it.id);
  removed++;
}
const failed = c.prepare(`SELECT item_id FROM item_errors WHERE message LIKE '%-11%'`).pluck().all() as number[];
for (let i = 0; i < failed.length; i += 2000) enqueue(db, "reindex", { itemIds: failed.slice(i, i + 2000) });
console.log(`심볼릭 링크 항목 ${removed}개 정리, 다시 확인 요청 ${failed.length}개`);
db.$client.close();
