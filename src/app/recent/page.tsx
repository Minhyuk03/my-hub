import { connection } from "next/server";
import { ItemRow } from "@/components/hub-ui";
import { getDb } from "@/server/db";
import { recentItems } from "@/server/queries";

function startOfDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function groupRecent<T extends { modifiedAt: number | null }>(items: T[]) {
  const today = startOfDay();
  const weekAgo = today - 6 * 86400_000;
  return [
    { label: "오늘", items: items.filter((i) => (i.modifiedAt ?? 0) >= today) },
    { label: "이번 주", items: items.filter((i) => (i.modifiedAt ?? 0) < today && (i.modifiedAt ?? 0) >= weekAgo) },
    { label: "이번 달", items: items.filter((i) => (i.modifiedAt ?? 0) < weekAgo) },
  ];
}

export default async function RecentPage() {
  await connection();
  const groups = groupRecent(recentItems(getDb(), startOfDay() - 29 * 86400_000, 300));
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">최근 수정</h1>
      {groups.every((g) => !g.items.length) && <p className="text-sm text-muted-foreground">최근 30일 안에 수정된 항목이 없습니다.</p>}
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
    </div>
  );
}
