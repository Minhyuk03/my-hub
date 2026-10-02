import Link from "next/link";
import { connection } from "next/server";
import { SourceIcon } from "@/components/hub-ui";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { relTime, shortPath } from "@/lib/format";
import { PROJECT_KIND_LABEL, PROJECT_STATUS_LABEL } from "@/lib/project-labels";
import { getDb } from "@/server/db";
import { projectList, type ParaTab } from "@/server/projects";
import { pendingSuggestions } from "@/server/projects/suggest";
import { acceptSuggestionAction, createProjectAction, refreshSuggestionsAction, rejectSuggestionAction, staleAction } from "./actions";
import { staleProjects } from "@/server/projects/stale";
import { getSettings } from "@/server/settings";

const PARA_TABS: [ParaTab, string, string][] = [
  ["project", "프로젝트", "끝이 있는 일. 마감이나 목표가 있는 것 (진행중)"],
  ["area", "영역", "끝이 없이 꾸준히 챙기는 책임 범위 (진로, 건강, 학교 생활 …)"],
  ["resource", "자료", "관심 주제와 참고 자료 (개발, 여행, 맥 세팅 …)"],
  ["archive", "보관", "완료하거나 보류한 것 (종류 상관없이)"],
];

export default async function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  await connection();
  const sp = await searchParams;
  // PARA 탭 (예전 ?status= 주소도 받는다: 완료·보류 → 보관)
  const tab: ParaTab =
    typeof sp.tab === "string" && ["project", "area", "resource", "archive"].includes(sp.tab)
      ? (sp.tab as ParaTab)
      : sp.status === "done" || sp.status === "on_hold"
        ? "archive"
        : "project";
  const db = getDb();
  const list = projectList(db, { tab });
  const counts = Object.fromEntries((["project", "area", "resource", "archive"] as const).map((t) => [t, projectList(db, { tab: t }).length]));
  const suggestions = pendingSuggestions(db);
  const stale = staleProjects(db);
  const staleDays = getSettings(db).staleProjectDays;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">PARA</h1>
        <nav className="flex flex-wrap gap-1 text-sm">
          {PARA_TABS.map(([k, label, hint]) => (
            <Link key={k} href={`/projects?tab=${k}`} title={hint} className={buttonVariants({ variant: tab === k ? "secondary" : "ghost", size: "sm" })}>
              {label} <span className="text-xs text-muted-foreground">{counts[k]}</span>
            </Link>
          ))}
        </nav>
        <Link href={`/projects/import?kind=${tab === "archive" ? "project" : tab}`} className={buttonVariants({ variant: "outline", size: "sm", className: "ml-auto" })}>
          Obsidian 에서 가져오기
        </Link>
      </div>

      <p className="text-sm text-muted-foreground">{PARA_TABS.find(([k]) => k === tab)![2]}</p>

      <form action={createProjectAction} className="flex max-w-lg gap-2">
        <select name="kind" defaultValue={tab === "archive" ? "project" : tab} className="h-9 rounded-md border bg-background px-2 text-sm">
          {Object.entries(PROJECT_KIND_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <Input name="name" placeholder="새 이름" required />
        <Button type="submit">만들기</Button>
      </form>

      {stale.length > 0 && tab === "project" && (
        <Card id="stale">
          <CardHeader>
            <CardTitle>쉬고 있는 프로젝트 ({stale.length})</CardTitle>
            <CardDescription>
              &ldquo;진행중&rdquo;인데 연결된 파일이 {staleDays}일 넘게 바뀌지 않았습니다. 끝난 프로젝트는 완료로, 잠시 멈춘 것은 보류로 바꾸면 홈 알림에서 빠집니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y text-sm">
            {stale.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-2 py-2">
                <Link href={`/projects/${p.id}`} className="truncate font-medium hover:underline">
                  {p.name}
                </Link>
                <span className="text-xs text-muted-foreground">{p.idleDays}일째 변화 없음</span>
                <span className="ml-auto flex gap-1">
                  <form action={staleAction.bind(null, p.id, "done")}>
                    <Button type="submit" size="sm" variant="outline" className="h-6 px-2 text-xs">
                      완료로
                    </Button>
                  </form>
                  <form action={staleAction.bind(null, p.id, "on_hold")}>
                    <Button type="submit" size="sm" variant="outline" className="h-6 px-2 text-xs">
                      보류로
                    </Button>
                  </form>
                  <form action={staleAction.bind(null, p.id, "snooze")}>
                    <Button type="submit" size="sm" variant="ghost" className="h-6 px-2 text-xs">
                      {staleDays}일 동안 알리지 않기
                    </Button>
                  </form>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {suggestions.length > 0 && tab !== "archive" && (
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
        {!list.length && <p className="text-sm text-muted-foreground">아직 없습니다. 위에서 만들거나, 제안을 수락하거나, Obsidian 에서 가져오세요.</p>}
        {list.map((p) => (
          <Link key={p.id} href={`/projects/${p.id}`} className="rounded-lg border p-4 hover:bg-muted">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{p.name}</span>
              {tab === "archive" && <Badge variant="outline">{PROJECT_KIND_LABEL[p.kind]}</Badge>}
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
