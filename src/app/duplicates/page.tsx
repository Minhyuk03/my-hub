import Link from "next/link";
import { connection } from "next/server";
import { ItemRow } from "@/components/hub-ui";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { bytes } from "@/lib/format";
import { getDb } from "@/server/db";
import { duplicateGroups, duplicateSummary } from "@/server/duplicates";

const SIZES = [
  { v: 1, label: "전부" },
  { v: 1024, label: "1KB 이상" },
  { v: 100 * 1024, label: "100KB 이상" },
  { v: 1024 * 1024, label: "1MB 이상" },
];
const PAGE = 50;

export default async function DuplicatesPage({ searchParams }: PageProps<"/duplicates">) {
  await connection();
  const sp = await searchParams;
  const db = getDb();
  const minSize = Number(sp.min ?? 1024) || 1;
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  const sum = duplicateSummary(db, minSize);
  const groups = duplicateGroups(db, { minSize, limit: PAGE, offset: page * PAGE });
  const q = (o: Record<string, number>) => `/duplicates?${new URLSearchParams(Object.entries({ min: minSize, page, ...o }).map(([k, v]) => [k, String(v)]))}`;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">중복 파일</h1>
        <p className="text-sm text-muted-foreground">
          내용이 완전히 같은 파일 묶음 {sum.groups.toLocaleString()}개 · 남는 사본 {sum.extra.toLocaleString()}개 · 정리하면 아낄 수 있는 용량 {bytes(sum.wasted)}
        </p>
        <p className="text-xs text-muted-foreground">
          허브는 목록만 보여 주고 파일을 지우거나 옮기지 않습니다. 정리는 각 파일 화면의 &ldquo;Finder에서 보기&rdquo;로 직접 하세요. iCloud 에만 있고 내려받지 않은
          파일, Notion·GitHub 는 내용을 비교할 수 없어 빠집니다.
        </p>
      </div>
      <div className="flex flex-wrap gap-1">
        {SIZES.map((s) => (
          <Link key={s.v} href={q({ min: s.v, page: 0 })} className={buttonVariants({ size: "sm", variant: s.v === minSize ? "secondary" : "ghost" })}>
            {s.label}
          </Link>
        ))}
      </div>
      {groups.map((g) => (
        <Card key={g.hash} size="sm">
          <CardHeader>
            <CardTitle className="text-sm">
              {g.count}개 같은 파일 · 각 {bytes(g.size)} <span className="font-normal text-muted-foreground">(사본 {g.count - 1}개, {bytes(g.wasted)})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {g.items.map((i) => (
              <ItemRow key={i.id} item={i} />
            ))}
          </CardContent>
        </Card>
      ))}
      {!groups.length && <p className="text-sm text-muted-foreground">중복 파일이 없습니다.</p>}
      <div className="flex gap-2">
        {page > 0 && (
          <Link href={q({ page: page - 1 })} className={buttonVariants({ variant: "outline", size: "sm" })}>
            ← 이전
          </Link>
        )}
        {(page + 1) * PAGE < sum.groups && (
          <Link href={q({ page: page + 1 })} className={buttonVariants({ variant: "outline", size: "sm" })}>
            다음 →
          </Link>
        )}
      </div>
    </div>
  );
}
