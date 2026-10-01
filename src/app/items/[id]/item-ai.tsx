import Link from "next/link";
import { getDb } from "@/server/db";
import { similarItems } from "@/server/ai/pipeline";
import { removeTag } from "@/app/ai/actions";
import { TagChips } from "@/app/ai/tag-chips";
import { SourceIcon } from "@/components/hub-ui";

/** 항목 화면의 AI 영역: 요약, 대기 중인 태그 제안, AI·사용자 태그 빼기, 비슷한 문서 */
export function ItemAi({ itemId, emoji }: { itemId: number; emoji: Record<string, string> }) {
  const db = getDb();
  const c = db.$client;
  const sug = c.prepare(`SELECT id, payload, status FROM ai_suggestions WHERE item_id = ? AND kind = 'tags'`).get(itemId) as
    | { id: number; payload: string; status: string }
    | undefined;
  const p = sug ? (JSON.parse(sug.payload) as { tags: string[]; summary?: string }) : null;
  const manual = c
    .prepare(`SELECT g.name, m.origin FROM item_tags_manual m JOIN tags g ON g.id = m.tag_id WHERE m.item_id = ? ORDER BY g.name`)
    .all(itemId) as { name: string; origin: string }[];
  const sim = similarItems(db, itemId, 6);
  const simRows = sim.length
    ? (c
        .prepare(`SELECT i.id, i.title, s.kind AS sourceKind FROM items i JOIN sources s ON s.id = i.source_id WHERE i.id IN (${sim.map(() => "?").join(",")}) AND i.state != 'deleted'`)
        .all(...sim.map((x) => x.id)) as { id: number; title: string; sourceKind: string }[])
    : [];
  const byId = new Map(simRows.map((r) => [r.id, r]));
  if (!p && !manual.length && !simRows.length) return null;

  return (
    <div className="space-y-2 rounded-lg border p-3 text-sm">
      {p?.summary && sug?.status !== "rejected" && (
        <p>
          <span className="mr-1 text-xs text-muted-foreground">AI 요약</span>
          {p.summary}
        </p>
      )}
      {manual.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-muted-foreground">붙인 태그</span>
          {manual.map((m) => (
            <form key={m.name} action={removeTag.bind(null, itemId, m.name)} className="inline-flex">
              <button type="submit" className="rounded-full border px-2 py-0.5 text-xs hover:bg-muted" title={`${m.origin === "ai" ? "AI 제안으로 붙인" : "직접 붙인"} 태그 — 눌러서 빼기`}>
                {emoji[m.name.split("/")[0]] ? `${emoji[m.name.split("/")[0]]} ` : ""}#{m.name} ✕
              </button>
            </form>
          ))}
        </div>
      )}
      {sug?.status === "pending" && p && p.tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">AI 태그 제안</span>
          <TagChips id={sug.id} tags={p.tags} emoji={emoji} />
        </div>
      )}
      {simRows.length > 0 && (
        <div>
          <p className="mb-1 text-xs text-muted-foreground">비슷한 문서</p>
          <ul className="space-y-0.5">
            {sim
              .filter((x) => byId.has(x.id))
              .map((x) => (
                <li key={x.id} className="flex items-center gap-2">
                  <SourceIcon kind={byId.get(x.id)!.sourceKind} className="size-3.5" />
                  <Link href={`/items/${x.id}`} className="truncate hover:underline">
                    {byId.get(x.id)!.title}
                  </Link>
                  <span className="ml-auto text-xs text-muted-foreground">{Math.round(x.score * 100)}%</span>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
