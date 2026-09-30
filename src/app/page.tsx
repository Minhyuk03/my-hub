import Link from "next/link";
import { connection } from "next/server";
import { ItemRow, SourceIcon, SourceStatusBadge } from "@/components/hub-ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { relTime, shortPath } from "@/lib/format";
import { getDb } from "@/server/db";
import { activeFolders, recentItems, sourcesWithStats, workerStatus } from "@/server/queries";
import { activeProjects } from "@/server/projects";

function startOfDay(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export default async function Home() {
  await connection();
  const db = getDb();
  const today = startOfDay();
  const weekAgo = today - 6 * 86400_000;
  const monthAgo = today - 29 * 86400_000;
  const recent = recentItems(db, monthAgo, 60);
  const groups = [
    { label: "오늘", items: recent.filter((i) => (i.modifiedAt ?? 0) >= today) },
    { label: "이번 주", items: recent.filter((i) => (i.modifiedAt ?? 0) < today && (i.modifiedAt ?? 0) >= weekAgo) },
    { label: "이번 달", items: recent.filter((i) => (i.modifiedAt ?? 0) < weekAgo) },
  ];
  const projectsActive = activeProjects(db);
  const folders = projectsActive.length ? [] : activeFolders(db, today - 13 * 86400_000);
  const srcs = sourcesWithStats(db);
  const worker = workerStatus(db);

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="md:col-span-2 md:row-span-2">
        <CardHeader>
          <CardTitle>최근 수정</CardTitle>
          <CardDescription>전체 소스의 최근 30일</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!recent.length && <p className="text-sm text-muted-foreground">최근 30일 안에 수정된 항목이 없습니다.</p>}
          {groups.map(
            (g) =>
              g.items.length > 0 && (
                <section key={g.label}>
                  <h3 className="mb-1 text-sm font-medium text-muted-foreground">{g.label}</h3>
                  <div className="divide-y">
                    {g.items.slice(0, 20).map((i) => (
                      <ItemRow key={i.id} item={i} />
                    ))}
                  </div>
                </section>
              ),
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>소스 상태</CardTitle>
          <CardDescription>
            인덱서 {worker.alive ? "실행 중" : "멈춤"}
            {!worker.alive && " — npm run hub 로 시작하세요"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {!srcs.length && (
            <p className="text-sm text-muted-foreground">
              연결된 소스가 없습니다. <Link href="/settings" className="underline">설정</Link>에서 폴더를 추가하세요.
            </p>
          )}
          {srcs.map((s) => (
            <Link key={s.id} href="/status" className="flex items-center gap-2 text-sm hover:underline">
              <SourceIcon kind={s.kind} />
              <span className="truncate">{s.name}</span>
              <span className="ml-auto flex shrink-0 items-center gap-2">
                <span className="text-xs text-muted-foreground">{s.total.toLocaleString()}</span>
                <SourceStatusBadge status={s.status} />
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>이어서 작업하기</CardTitle>
          <CardDescription>{projectsActive.length ? "최근 2주 동안 활동이 많은 프로젝트" : "최근 2주 동안 수정이 많은 폴더 (프로젝트를 만들면 프로젝트로 표시)"}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {projectsActive.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`} className="block text-sm hover:underline">
              <div className="flex gap-2">
                <span className="truncate font-medium">{p.name}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {p.recentCount}개 수정 · {relTime(p.lastModified)}
                </span>
              </div>
              {p.memo && <div className="truncate text-xs text-muted-foreground">{p.memo}</div>}
            </Link>
          ))}
          {!projectsActive.length && !folders.length && <p className="text-sm text-muted-foreground">최근 활동이 없습니다.</p>}
          {folders.map((f) => (
            <Link key={f.folderId} href={`/search?q=${encodeURIComponent(f.name)}`} className="block text-sm hover:underline">
              <div className="flex gap-2">
                <span className="truncate font-medium">{f.name}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {f.count}개 · {relTime(f.last)}
                </span>
              </div>
              <div className="truncate text-xs text-muted-foreground">{shortPath(f.path)}</div>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
