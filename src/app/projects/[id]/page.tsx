import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { eq } from "drizzle-orm";
import { ItemRow, SourceIcon } from "@/components/hub-ui";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { shortPath } from "@/lib/format";
import { PROJECT_STATUS_LABEL } from "@/lib/project-labels";
import { getDb } from "@/server/db";
import { projects } from "@/server/db/schema";
import { excludedItems, projectFolderList, projectItemList } from "@/server/projects";
import { ConfirmSubmit } from "@/app/settings/confirm-submit";
import { deleteProjectAction, itemRuleAction, saveProjectAction, toggleSubfoldersAction, unlinkFolderAction } from "../actions";
import { FolderLinker } from "./folder-linker";
import { PolicyToggle } from "@/components/policy-toggle";

function dayLabel(ms: number) {
  const d = new Date(ms);
  return d.toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
}

/** 최근 활동 타임라인 (최근 30일, 날짜별) */
function buildTimeline<T extends { modifiedAt: number | null }>(items: T[]) {
  const since = Date.now() - 30 * 86400_000;
  const timeline = new Map<string, T[]>();
  for (const it of items.filter((i) => (i.modifiedAt ?? 0) >= since)) {
    const k = dayLabel(it.modifiedAt!);
    if (!timeline.has(k)) timeline.set(k, []);
    timeline.get(k)!.push(it);
  }
  return timeline;
}

export default async function ProjectPage({ params, searchParams }: PageProps<"/projects/[id]">) {
  await connection();
  const { id } = await params;
  const sp = await searchParams;
  const db = getDb();
  const p = db.select().from(projects).where(eq(projects.id, Number(id))).get();
  if (!p) notFound();
  const sourceFilter = typeof sp.source === "string" ? Number(sp.source) : undefined;
  const fl = projectFolderList(db, p.id);
  const all = projectItemList(db, p.id, { limit: 300 });
  const list = sourceFilter ? projectItemList(db, p.id, { sourceIds: [sourceFilter], limit: 300 }) : all;
  const excluded = excludedItems(db, p.id);
  const sourcesInProject = [...new Map(all.items.map((i) => [i.sourceId, { id: i.sourceId, name: i.sourceName, kind: i.sourceKind }])).values()];

  const timeline = buildTimeline(all.items);

  return (
    <div className="space-y-4">
      <form action={saveProjectAction.bind(null, p.id)} className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input name="name" defaultValue={p.name} className="h-10 max-w-md text-lg font-semibold" />
          <select name="status" defaultValue={p.status} className="h-10 rounded-md border bg-background px-2 text-sm">
            {Object.entries(PROJECT_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline">
            저장
          </Button>
          <Link href={`/search?project=${p.id}`} className={buttonVariants({ variant: "ghost" })}>
            이 프로젝트에서 검색
          </Link>
          <Link href={`/chat?project=${p.id}`} className={buttonVariants({ variant: "ghost" })}>
            AI 에게 묻기
          </Link>
        </div>
        <PolicyToggle kind="project" id={p.id} denied={p.externalPolicy === "deny"} />
        <textarea name="memo" defaultValue={p.memo} placeholder="메모" rows={3} className="w-full rounded-md border bg-background p-2 text-sm" />
      </form>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-4 md:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>
                항목 {all.total.toLocaleString()}개{list !== all && ` (필터 ${list.total.toLocaleString()}개)`}
              </CardTitle>
              {sourcesInProject.length > 1 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  <Link href={`/projects/${p.id}`} className={buttonVariants({ variant: sourceFilter ? "ghost" : "secondary", size: "sm" })}>
                    전체
                  </Link>
                  {sourcesInProject.map((s) => (
                    <Link key={s.id} href={`/projects/${p.id}?source=${s.id}`} className={buttonVariants({ variant: sourceFilter === s.id ? "secondary" : "ghost", size: "sm" })}>
                      <SourceIcon kind={s.kind} /> {s.name}
                    </Link>
                  ))}
                </div>
              )}
            </CardHeader>
            <CardContent>
              {!list.items.length && <p className="text-sm text-muted-foreground">연결된 항목이 없습니다. 오른쪽에서 폴더를 연결하세요.</p>}
              <div className="divide-y">
                {list.items.map((i) => (
                  <div key={i.id} className="flex items-start gap-1">
                    <div className="min-w-0 flex-1">
                      <ItemRow item={i} />
                    </div>
                    <form action={itemRuleAction.bind(null, p.id, i.id, i.rule === "include" ? "clear" : "exclude")}>
                      <Button type="submit" variant="ghost" size="sm" className="mt-1 text-xs text-muted-foreground">
                        {i.rule === "include" ? "빼기" : "제외"}
                      </Button>
                    </form>
                  </div>
                ))}
              </div>
              {list.total > list.items.length && <p className="pt-2 text-xs text-muted-foreground">최근 {list.items.length}개만 표시합니다. 나머지는 &ldquo;이 프로젝트에서 검색&rdquo;을 쓰세요.</p>}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>연결된 폴더</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {!fl.length && <p className="text-muted-foreground">아직 없습니다.</p>}
              {fl.map((f) => (
                <div key={f.folderId} className="space-y-1 border-b pb-2 last:border-0">
                  <div className="flex items-center gap-2">
                    <SourceIcon kind={f.sourceKind} />
                    <span className="truncate font-medium">{f.name}</span>
                  </div>
                  <p className="break-all text-xs text-muted-foreground">{shortPath(f.path)}</p>
                  {f.warning && <p className="text-xs text-destructive">⚠ {f.warning}</p>}
                  <div className="flex flex-wrap gap-1">
                    <form action={toggleSubfoldersAction.bind(null, p.id, f.folderId, !f.includeSubfolders)}>
                      <Button type="submit" variant="ghost" size="sm" className="text-xs">
                        하위 폴더 {f.includeSubfolders ? "포함 ✓" : "제외"}
                      </Button>
                    </form>
                    <form action={unlinkFolderAction.bind(null, p.id, f.folderId)}>
                      <Button type="submit" variant="ghost" size="sm" className="text-xs">
                        연결 해제
                      </Button>
                    </form>
                  </div>
                </div>
              ))}
              <FolderLinker projectId={p.id} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>최근 활동</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {!timeline.size && <p className="text-muted-foreground">최근 30일 동안 수정된 항목이 없습니다.</p>}
              {[...timeline.entries()].slice(0, 10).map(([day, its]) => (
                <div key={day}>
                  <p className="text-xs font-medium text-muted-foreground">{day}</p>
                  <ul>
                    {its.slice(0, 5).map((i) => (
                      <li key={i.id} className="flex items-center gap-1">
                        <SourceIcon kind={i.sourceKind} className="size-3" />
                        <Link href={`/items/${i.id}`} className="truncate hover:underline">
                          {i.title}
                        </Link>
                      </li>
                    ))}
                    {its.length > 5 && <li className="text-xs text-muted-foreground">외 {its.length - 5}개</li>}
                  </ul>
                </div>
              ))}
            </CardContent>
          </Card>

          {excluded.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>제외한 항목</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {excluded.map((e) => (
                  <form key={e.id} action={itemRuleAction.bind(null, p.id, e.id, "clear")} className="flex items-center gap-2">
                    <span className="flex-1 truncate">{e.title}</span>
                    <Button type="submit" variant="ghost" size="sm" className="text-xs">
                      되돌리기
                    </Button>
                  </form>
                ))}
              </CardContent>
            </Card>
          )}

          <form action={deleteProjectAction.bind(null, p.id)}>
            <ConfirmSubmit message={`'${p.name}' 프로젝트를 지울까요? 연결 정보만 지워지고 실제 파일은 그대로 남습니다.`}>프로젝트 삭제</ConfirmSubmit>
          </form>
        </div>
      </div>
    </div>
  );
}
