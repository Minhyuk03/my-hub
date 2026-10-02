/**
 * 태그 합치기 (별명 규칙): "수업 → 학교" 처럼 여러 태그를 허브 안에서 하나로 본다.
 * - Obsidian·Notion 원본 파일은 바꾸지 않는다. 색인할 때 이름을 바꿔 저장할 뿐이다.
 * - 하위 태그도 따라간다: "수업/자료구조" → "학교/자료구조"
 * - 규칙을 바꾸면 applyTagAliases 로 이미 저장된 태그도 다시 맞춘다. 규칙을 지우고 다시 색인하면 원래대로 돌아온다.
 */
import { eq, inArray } from "drizzle-orm";
import type { Db } from "./db";
import { itemTags, itemTagsManual, tags, tagStyles } from "./db/schema";
import { getSettings } from "./settings";

export type TagAliases = Record<string, string>;

const nfc = (s: string) => s.trim().normalize("NFC");

/** 별명 규칙을 적용한 이름 (규칙이 연쇄되면 끝까지 따라가되, 순환은 막는다) */
export function aliasOf(aliases: TagAliases, name: string): string {
  let cur = nfc(name);
  const seen = new Set<string>();
  for (;;) {
    if (seen.has(cur)) return cur;
    seen.add(cur);
    const lower = cur.toLowerCase();
    let next: string | null = null;
    for (const [from, to] of Object.entries(aliases)) {
      const f = nfc(from).toLowerCase();
      if (lower === f) next = nfc(to);
      else if (lower.startsWith(f + "/")) next = nfc(to) + cur.slice(f.length);
      if (next) break;
    }
    if (!next || next === cur) return cur;
    cur = next;
  }
}

export const tagAliases = (db: Db): TagAliases => getSettings(db).tagAliases;

/** 이름 목록에 규칙 적용 + 중복 제거 */
export function aliasAll(aliases: TagAliases, names: string[]): string[] {
  return [...new Set(names.map((n) => aliasOf(aliases, n)).filter(Boolean))];
}

/** "수업 = 학교" 한 줄씩 → 규칙. 잘못된 줄은 건너뛴다 */
export function parseAliasLines(text: string): TagAliases {
  const out: TagAliases = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*#?([^=→>]+?)\s*(?:=|→|->|>)\s*#?(.+?)\s*$/);
    if (!m) continue;
    const from = nfc(m[1]);
    const to = nfc(m[2]);
    if (from && to && from.toLowerCase() !== to.toLowerCase()) out[from] = to;
  }
  return out;
}

/** 이미 저장된 태그(본문 태그·수락한 태그·이모지)를 지금 규칙에 맞게 옮긴다. 옮긴 태그 이름 수를 돌려준다 */
export function applyTagAliases(db: Db, aliases: TagAliases = tagAliases(db)): number {
  const all = db.select().from(tags).all();
  let moved = 0;
  db.transaction(() => {
    for (const t of all) {
      const target = aliasOf(aliases, t.name);
      if (target === t.name) continue;
      db.insert(tags).values({ name: target }).onConflictDoNothing().run();
      const to = db.select().from(tags).where(eq(tags.name, target)).get()!;
      for (const table of [itemTags, itemTagsManual] as const) {
        const rows = db.select().from(table).where(eq(table.tagId, t.id)).all();
        for (const r of rows) {
          if (table === itemTags) db.insert(itemTags).values({ itemId: r.itemId, tagId: to.id }).onConflictDoNothing().run();
          else db.insert(itemTagsManual).values({ ...(r as typeof itemTagsManual.$inferSelect), tagId: to.id }).onConflictDoNothing().run();
        }
        db.delete(table).where(eq(table.tagId, t.id)).run();
      }
      // 이모지는 합친 쪽에 없을 때만 넘겨준다
      const style = db.select().from(tagStyles).where(eq(tagStyles.name, t.name)).get();
      if (style) {
        db.insert(tagStyles).values({ name: target, emoji: style.emoji }).onConflictDoNothing().run();
        db.delete(tagStyles).where(eq(tagStyles.name, t.name)).run();
      }
      moved++;
    }
    // 아무 데도 쓰이지 않는 태그 이름 정리
    const used = new Set([...db.select({ id: itemTags.tagId }).from(itemTags).all(), ...db.select({ id: itemTagsManual.tagId }).from(itemTagsManual).all()].map((r) => r.id));
    const unused = db.select({ id: tags.id }).from(tags).all().map((r) => r.id).filter((id) => !used.has(id));
    for (let i = 0; i < unused.length; i += 500) db.delete(tags).where(inArray(tags.id, unused.slice(i, i + 500))).run();
  });
  return moved;
}
