import { FolderKanban, FolderOpen, Plus } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { BookmarkBar, SiteIcon } from "@/components/home/bookmark-bar";
import { HomeSearch } from "@/components/home/home-search";
import { SourceIcon, SourceStatusBadge, StateBadge } from "@/components/hub-ui";
import { relTime, shortPath } from "@/lib/format";
import { getDb } from "@/server/db";
import { bookmarkBar, tiles } from "@/server/home";
import { activeProjects } from "@/server/projects";
import {
  activeFolders,
  recentItems,
  sourcesWithStats,
  workerStatus,
} from "@/server/queries";
import { getSettings } from "@/server/settings";
import { eq } from "drizzle-orm";
import { Agenda } from "@/components/home/agenda";
import type { CalendarSnapshot } from "@/server/calendar";
import { runtime } from "@/server/db/schema";
import { staleProjects } from "@/server/projects/stale";
import { staleAction } from "@/app/projects/actions";
import { driveExpiry } from "@/server/connectors/gdrive/client";

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-background/80 p-4 shadow-sm backdrop-blur">
      <div className="mb-2 flex items-center">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="ml-auto">{action}</span>
      </div>
      {children}
    </section>
  );
}

function sinceTimes(now = Date.now()) {
  return { since14: now - 14 * 86400_000, since30: now - 30 * 86400_000 };
}

function greeting(d = new Date()) {
  return d.toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

export default async function Home() {
  await connection();
  const db = getDb();
  const s = getSettings(db);
  const bar = bookmarkBar(db);
  const tileList = tiles(db);
  const { since14, since30 } = sinceTimes();
  const recent = recentItems(db, since30, 12);
  const projectsActive = activeProjects(db);
  const folders = projectsActive.length ? [] : activeFolders(db, since14, 5);
  const srcs = sourcesWithStats(db);
  const stale = staleProjects(db);
  const calendar = s.calendarEnabled ? ((db.select().from(runtime).where(eq(runtime.key, "calendar")).get()?.value as CalendarSnapshot | undefined) ?? null) : null;
  const worker = workerStatus(db);
  const exp = driveExpiry(s.gdriveAccount, s.gdriveTestingMode);
  const driveOffline = srcs.find((x) => x.kind === "gdrive" && x.status === "offline" && /만료|연결되어 있지/.test(x.lastError ?? ""));
  const driveNotice = driveOffline
    ? "Google Drive 연결이 만료되었습니다. 가져온 내용은 그대로 검색됩니다."
    : exp?.soon
      ? `Google Drive 연결이 ${exp.leftDays <= 1 ? "곧" : `${exp.leftDays}일 후`} 만료됩니다 (테스트 중인 Google 앱은 7일마다 다시 연결 필요).`
      : null;

  return (
    <>
      {/* 배경: 설정한 이미지 또는 기본 그라데이션 */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        {s.homeBackground ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/home/background?v=${encodeURIComponent(s.homeBackground)}`}
              alt=""
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-background/30" />
          </>
        ) : (
          <div className="h-full w-full bg-[radial-gradient(ellipse_at_top,var(--color-muted),transparent_60%)]" />
        )}
      </div>

      {/* 홈은 화면 전체 폭을 쓴다: 위 북마크 바, 가운데 검색·타일, 오른쪽 끝에 붙은 사이드 패널 */}
      <div className="-my-6 mx-[calc(50%-50vw)] flex min-h-[calc(100dvh-61px)] flex-col">
        <BookmarkBar root={bar.root} groups={bar.groups} />
        {driveNotice && (
          <a href="/settings#gdrive" className="block border-b border-foreground/10 bg-amber-500/15 px-4 py-2 text-sm hover:bg-amber-500/25">
            {driveNotice} → 설정에서 다시 연결
          </a>
        )}

        <div className="flex flex-1 flex-col lg:flex-row">
          {/* 가운데: 검색 + 즐겨찾기 타일 */}
          <section className="flex flex-1 flex-col items-center gap-8 px-4 py-8 lg:py-16 2xl:pl-[400px]">
            <div className="text-center">
              <h1 className="text-4xl font-semibold tracking-tight drop-shadow-sm sm:text-5xl">{s.homeTitle || "나의 허브"}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{greeting()}</p>
            </div>
            <HomeSearch />
            <div className="flex w-full max-w-2xl flex-wrap justify-center gap-2">
              {tileList.map((t) => (
                <a
                  key={t.id}
                  href={t.href}
                  title={t.subtitle}
                  className="group flex w-24 flex-col items-center gap-2 rounded-xl p-2 text-center hover:bg-foreground/10"
                >
                  <span
                    className={`relative flex size-12 items-center justify-center rounded-full shadow-sm ${t.kind === "url" ? "bg-white" : "bg-background/90"}`}
                  >
                    {t.kind === "url" ? (
                      <SiteIcon url={t.href} title={t.title} size={24} />
                    ) : t.kind === "project" ? (
                      <FolderKanban className="size-6 text-muted-foreground" />
                    ) : (
                      <FolderOpen className="size-6 text-muted-foreground" />
                    )}
                    {t.kind === "folder" && t.sourceKind && (
                      <span className="absolute -bottom-1 -right-1 rounded-full bg-background p-0.5">
                        <SourceIcon kind={t.sourceKind} className="size-3" />
                      </span>
                    )}
                  </span>
                  <span className="line-clamp-2 w-full text-xs font-medium drop-shadow-sm">
                    {t.title}
                  </span>
                  {t.warning && (
                    <span className="text-[10px] text-destructive">
                      {t.warning}
                    </span>
                  )}
                </a>
              ))}
              <Link
                href="/home/edit#tiles"
                className="flex w-24 flex-col items-center gap-2 rounded-xl p-2 text-center hover:bg-foreground/10"
              >
                <span className="flex size-12 items-center justify-center rounded-full bg-background/90 shadow-sm">
                  <Plus className="size-5 text-muted-foreground" />
                </span>
                <span className="text-xs font-medium">즐겨찾기 추가</span>
              </Link>
            </div>
          </section>

          {/* 사이드: 이어서 작업하기, 최근 수정, 소스 상태 */}
          <aside className="space-y-4 border-t border-foreground/10 bg-background/60 p-4 backdrop-blur lg:w-[360px] lg:shrink-0 lg:border-l lg:border-t-0 xl:w-[400px]">
            {s.calendarEnabled && (
              <Panel title="일정">
                <Agenda snap={calendar} hidden={s.calendarHidden} />
              </Panel>
            )}
            <Panel
              title="이어서 작업하기"
              action={
                <Link
                  href="/projects"
                  className="text-xs text-muted-foreground hover:underline"
                >
                  프로젝트
                </Link>
              }
            >
              <div className="space-y-2">
                {projectsActive.map((p) => (
                  <Link
                    key={p.id}
                    href={`/projects/${p.id}`}
                    className="block text-sm hover:underline"
                  >
                    <div className="flex gap-2">
                      <span className="truncate font-medium">{p.name}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {p.recentCount}개 · {relTime(p.lastModified)}
                      </span>
                    </div>
                  </Link>
                ))}
                {folders.map((f) => (
                  <Link
                    key={f.folderId}
                    href={`/folders/${f.folderId}`}
                    className="block text-sm hover:underline"
                  >
                    <div className="flex gap-2">
                      <span className="truncate font-medium">{f.name}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {f.count}개 · {relTime(f.last)}
                      </span>
                    </div>
                  </Link>
                ))}
                {!projectsActive.length && !folders.length && (
                  <p className="text-sm text-muted-foreground">
                    최근 2주 동안 활동이 없습니다.
                  </p>
                )}
              </div>
            </Panel>

            {stale.length > 0 && (
              <Panel
                title="쉬고 있는 프로젝트"
                action={
                  <Link href="/projects" className="text-xs text-muted-foreground hover:underline">
                    {stale.length}개 · 프로젝트에서 정리
                  </Link>
                }
              >
                <ul className="space-y-2">
                  {stale.slice(0, 4).map((p) => (
                    <li key={p.id} className="text-sm">
                      <div className="flex gap-2">
                        <Link href={`/projects/${p.id}`} className="truncate font-medium hover:underline">
                          {p.name}
                        </Link>
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">{p.idleDays}일째 변화 없음</span>
                      </div>
                      <div className="mt-0.5 flex gap-2 text-xs">
                        <form action={staleAction.bind(null, p.id, "on_hold")}>
                          <button className="text-muted-foreground hover:text-foreground hover:underline">보류로</button>
                        </form>
                        <form action={staleAction.bind(null, p.id, "done")}>
                          <button className="text-muted-foreground hover:text-foreground hover:underline">완료로</button>
                        </form>
                        <form action={staleAction.bind(null, p.id, "snooze")}>
                          <button className="text-muted-foreground hover:text-foreground hover:underline">{s.staleProjectDays}일 동안 알리지 않기</button>
                        </form>
                      </div>
                    </li>
                  ))}
                  {stale.length > 4 && <li className="text-xs text-muted-foreground">외 {stale.length - 4}개</li>}
                </ul>
              </Panel>
            )}

            <Panel
              title="최근 수정"
              action={
                <Link
                  href="/recent"
                  className="text-xs text-muted-foreground hover:underline"
                >
                  전체 보기
                </Link>
              }
            >
              <ul className="space-y-1">
                {recent.map((i) => (
                  <li key={i.id}>
                    <Link
                      href={`/items/${i.id}`}
                      className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted"
                      title={shortPath(i.path)}
                    >
                      <SourceIcon kind={i.sourceKind} className="size-3.5" />
                      <span className="truncate">{i.title}</span>
                      <StateBadge
                        state={i.state}
                        sourceStatus={i.sourceStatus}
                      />
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {relTime(i.modifiedAt)}
                      </span>
                    </Link>
                  </li>
                ))}
                {!recent.length && (
                  <li className="text-sm text-muted-foreground">
                    최근 30일 안에 수정된 항목이 없습니다.
                  </li>
                )}
              </ul>
            </Panel>

            <Panel
              title="소스 상태"
              action={
                <span
                  className={
                    worker.alive
                      ? "text-xs text-muted-foreground"
                      : "text-xs text-destructive"
                  }
                >
                  인덱서 {worker.alive ? "실행 중" : "멈춤"}
                </span>
              }
            >
              <div className="space-y-1.5">
                {srcs.map((src) => (
                  <Link
                    key={src.id}
                    href="/status"
                    className="flex items-center gap-2 text-sm hover:underline"
                  >
                    <SourceIcon kind={src.kind} />
                    <span className="truncate">{src.name}</span>
                    <span className="ml-auto flex shrink-0 items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {src.total.toLocaleString()}
                      </span>
                      <SourceStatusBadge status={src.status} />
                    </span>
                  </Link>
                ))}
                {!srcs.length && (
                  <p className="text-sm text-muted-foreground">
                    연결된 소스가 없습니다.{" "}
                    <Link href="/settings" className="underline">
                      설정
                    </Link>
                  </p>
                )}
              </div>
            </Panel>
          </aside>
        </div>
      </div>
    </>
  );
}
