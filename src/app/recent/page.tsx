import Link from "next/link";
import { connection } from "next/server";
import { CategoryFilter } from "@/components/category-filter";
import { ItemRow } from "@/components/hub-ui";
import { getDb } from "@/server/db";
import { recentCount, recentItems } from "@/server/queries";
import { fromRecord } from "@/server/search/params";
import { categoryFilter, isCategory } from "@/server/category";

const STEP = 300;

function startOfDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function groupRecent<T extends { modifiedAt: number | null }>(items: T[]) {
  const today = startOfDay();
  const weekAgo = today - 6 * 86400_000;
  return [
    { label: "오늘", items: items.filter((i) => (i.modifiedAt ?? 0) >= today) },
    { label: "최근 7일", items: items.filter((i) => (i.modifiedAt ?? 0) < today && (i.modifiedAt ?? 0) >= weekAgo) },
    { label: "8–30일 전", items: items.filter((i) => (i.modifiedAt ?? 0) < weekAgo) },
  ];
}

export default async function RecentPage({ searchParams }: PageProps<"/recent">) {
  await connection();
  const sp = await searchParams;
  const p = fromRecord(sp);
  const limit = Math.min(3000, Math.max(STEP, Number(p.get("n")) || STEP));
  const cats = categoryFilter(p.getAll("cat").filter(isCategory));
  const since = startOfDay() - 29 * 86400_000;
  const db = getDb();
  const list = recentItems(db, since, limit, cats);
  const total = recentCount(db, since, cats);
  const groups = groupRecent(list);
  const more = new URLSearchParams();
  for (const c of cats ?? []) more.append("cat", c);
  more.set("n", String(limit + STEP));
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">최근 수정</h1>
        <CategoryFilter inline />
        <p className="text-xs text-muted-foreground">
          최근 30일 {total.toLocaleString()}개{total > list.length && ` 중 최근 ${list.length.toLocaleString()}개`}
        </p>
      </div>
      {!total && <p className="text-sm text-muted-foreground">최근 30일 안에 수정된 항목이 없습니다.</p>}
      {groups.map(
        (g) =>
          g.items.length > 0 && (
            <section key={g.label}>
              <h2 className="mb-1 text-sm font-medium text-muted-foreground">
                {g.label} ({g.items.length})
              </h2>
              <div className="divide-y">
                {g.items.map((i) => (
                  <ItemRow key={i.id} item={i} />
                ))}
              </div>
            </section>
          ),
      )}
      {total > list.length && limit < 3000 && (
        <Link href={`/recent?${more}`} scroll={false} className="text-sm underline">
          {Math.min(STEP, total - list.length).toLocaleString()}개 더 보기
        </Link>
      )}
    </div>
  );
}
