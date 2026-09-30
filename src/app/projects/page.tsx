import Link from "next/link";
import { connection } from "next/server";
import { SourceIcon } from "@/components/hub-ui";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { relTime, shortPath } from "@/lib/format";
import { PROJECT_STATUS_LABEL } from "@/lib/project-labels";
import { getDb } from "@/server/db";
import type { ProjectStatus } from "@/server/db/schema";
import { projectList } from "@/server/projects";
import { pendingSuggestions } from "@/server/projects/suggest";
import { acceptSuggestionAction, createProjectAction, refreshSuggestionsAction, rejectSuggestionAction } from "./actions";

export default async function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  await connection();
  const sp = await searchParams;
  const status = (typeof sp.status === "string" && sp.status in PROJECT_STATUS_LABEL ? sp.status : undefined) as ProjectStatus | undefined;
  const db = getDb();
  const list = projectList(db, status);
  const suggestions = pendingSuggestions(db);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">프로젝트</h1>
        <nav className="flex gap-1 text-sm">
          {[["", "전체"], ...Object.entries(PROJECT_STATUS_LABEL)].map(([k, label]) => (
            <Link key={k} href={k ? `/projects?status=${k}` : "/projects"} className={buttonVariants({ variant: (status ?? "") === k ? "secondary" : "ghost", size: "sm" })}>
              {label}
            </Link>
          ))}
        </nav>
        <Link href="/projects/import" className={buttonVariants({ variant: "outline", size: "sm", className: "ml-auto" })}>
          Obsidian 1. Projects 가져오기
        </Link>
      </div>

      <form action={createProjectAction} className="flex max-w-md gap-2">
        <Input name="name" placeholder="새 프로젝트 이름" required />
        <Button type="submit">만들기</Button>
      </form>

      {suggestions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>같은 프로젝트로 묶을까요?</CardTitle>
            <CardDescription>서로 다른 곳에 이름이 비슷한 폴더가 있습니다. 수락해야만 연결되고, 거절한 제안은 다시 보이지 않습니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {suggestions.slice(0, 20).map((s) => (
              <div key={s.id} className="space-y-2 rounded-md border p-3 text-sm">
                <p className="text-muted-foreground">{s.reason}</p>
                <ul className="space-y-1">
                  {s.folders.map((f) => (
                    <li key={f!.id} className="flex items-center gap-2">
                      <SourceIcon kind={f!.sourceKind} />
                      <span className="truncate">{shortPath(f!.path)}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap items-center gap-2">
                  <form action={acceptSuggestionAction.bind(null, s.id)} className="flex flex-wrap items-center gap-2">
                    {s.projectName ? (
                      <Button type="submit" size="sm">
                        &lsquo;{s.projectName}&rsquo;에 추가
                      </Button>
                    ) : (
                      <>
                        <Input name="name" defaultValue={s.suggestedName} className="h-8 w-48" />
                        <Button type="submit" size="sm">
                          프로젝트로 묶기
                        </Button>
                      </>
                    )}
                  </form>
                  <form action={rejectSuggestionAction.bind(null, s.id)}>
                    <Button type="submit" size="sm" variant="ghost">
                      거절
                    </Button>
                  </form>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {!list.length && <p className="text-sm text-muted-foreground">프로젝트가 없습니다. 위에서 만들거나, 제안을 수락하거나, Obsidian에서 가져오세요.</p>}
        {list.map((p) => (
          <Link key={p.id} href={`/projects/${p.id}`} className="rounded-lg border p-4 hover:bg-muted">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{p.name}</span>
              <Badge variant={p.status === "active" ? "secondary" : "outline"}>{PROJECT_STATUS_LABEL[p.status]}</Badge>
              <span className="ml-auto text-xs text-muted-foreground">{relTime(p.lastModified)}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              폴더 {p.folderCount}개 · 항목 {p.itemCount.toLocaleString()}개 · 최근 2주 수정 {p.recentCount}개
            </p>
            {p.memo && <p className="mt-1 line-clamp-2 text-sm">{p.memo}</p>}
          </Link>
        ))}
      </div>

      <form action={refreshSuggestionsAction}>
        <Button type="submit" variant="ghost" size="sm">
          연결 제안 다시 계산
        </Button>
      </form>
    </div>
  );
}
