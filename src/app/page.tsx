import { ExternalLink, FolderKanban, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { SourceIcon } from "@/components/hub-ui";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { relTime } from "@/lib/format";
import { getDb } from "@/server/db";
import { projects } from "@/server/db/schema";
import { linkHref, normalizeProfile } from "@/server/profile";
import { projectItemList } from "@/server/projects";
import { getSettings } from "@/server/settings";
import { addHubProject } from "./profile/actions";

/** 섹션 제목 + 비었을 때 안내 (편집 화면의 같은 섹션으로) */
function Section({ id, title, empty, children }: { id: string; title: string; empty: boolean; children: React.ReactNode }) {
  return (
    <section id={id} className="min-w-0 space-y-3">
      <h2 className="border-b pb-1 text-sm font-semibold tracking-wide text-muted-foreground">{title}</h2>
      {empty ? (
        <Link href={`/profile/edit#${id}`} className="block rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground hover:bg-muted">
          아직 비어 있습니다 · 편집에서 추가
        </Link>
      ) : (
        children
      )}
    </section>
  );
}

const chips = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

export default async function ProfilePage() {
  await connection();
  const db = getDb();
  const p = normalizeProfile(getSettings(db).profile);
  const allProjects = db.select().from(projects).all();
  const projectName = new Map(allProjects.map((x) => [x.id, x]));
  const blank = !p.name && !p.headline && !p.about && !p.links.length && !p.education.length && !p.skills.length && !p.experience.length && !p.awards.length && !p.projects.length;
  // 포트폴리오 후보: 아직 넣지 않은 허브 프로젝트 (PARA 의 "프로젝트" 종류, 최근에 바뀐 순)
  const linked = new Set(p.projects.map((x) => x.projectId));
  const candidates = allProjects
    .filter((x) => x.kind === "project" && !linked.has(x.id))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 12);

  return (
    <div className="space-y-8">
      {/* 머리: 이름·한 줄 소개·연락처 */}
      <header className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <h1 className="text-3xl font-bold tracking-tight text-balance">
            {p.name || <span className="text-muted-foreground">이름</span>}
            {p.nameEn && <span className="ml-3 text-lg font-normal text-muted-foreground">{p.nameEn}</span>}
          </h1>
          <p className="text-lg text-muted-foreground">{p.headline || "한 줄 소개를 적어 주세요."}</p>
          {p.links.length > 0 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {p.links.map((l, i) => (
                <li key={i}>
                  <span className="text-muted-foreground">{l.label}</span>{" "}
                  {linkHref(l.url) ? (
                    <a href={linkHref(l.url)} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                      {l.url}
                    </a>
                  ) : (
                    l.url
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <Link href="/profile/edit" className={buttonVariants({ variant: "outline", size: "sm" })}>
          <Pencil className="size-3.5" /> 편집
        </Link>
      </header>

      {blank && (
        <div className="rounded-lg border bg-muted/40 p-4 text-sm">
          <p className="font-medium">자기소개가 아직 비어 있습니다.</p>
          <p className="mt-1 text-muted-foreground">
            <Link href="/profile/edit" className="underline">
              편집
            </Link>
            에서 인적사항·학력·기술·경력을 채우고, 아래 허브 프로젝트를 포트폴리오에 넣어 보세요. 즐겨찾기·일정·최근 수정은{" "}
            <Link href="/hub" className="underline">
              허브
            </Link>
            로 옮겼습니다.
          </p>
        </div>
      )}

      <Section id="about" title="자기소개" empty={!p.about}>
        <p className="max-w-[70ch] whitespace-pre-wrap leading-relaxed">{p.about}</p>
      </Section>

      <div className="grid gap-8 md:grid-cols-2">
        <div className="min-w-0 space-y-8">
          <Section id="education" title="학력" empty={!p.education.length}>
            <ul className="space-y-2">
              {p.education.map((e, i) => (
                <li key={i}>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{e.school}</span>
                    <span className="text-sm">{e.major}</span>
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">{e.period}</span>
                  </div>
                  {e.note && <p className="text-sm text-muted-foreground">{e.note}</p>}
                </li>
              ))}
            </ul>
          </Section>
          <Section id="skills" title="기술" empty={!p.skills.length}>
            <dl className="space-y-2">
              {p.skills.map((s, i) => (
                <div key={i} className="grid grid-cols-[6rem_1fr] gap-2">
                  <dt className="text-sm text-muted-foreground">{s.group}</dt>
                  <dd className="flex flex-wrap gap-1">
                    {chips(s.items).map((c) => (
                      <Badge key={c} variant="secondary">
                        {c}
                      </Badge>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </Section>
          <Section id="awards" title="수상·자격증" empty={!p.awards.length}>
            <ul className="space-y-1">
              {p.awards.map((a, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-sm">
                  <span className="font-medium">{a.title}</span>
                  <span className="text-muted-foreground">{a.org}</span>
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">{a.date}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>
        <Section id="experience" title="경력·활동" empty={!p.experience.length}>
          <ol className="space-y-3 border-l pl-4">
            {p.experience.map((e, i) => (
              <li key={i} className="space-y-0.5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{e.title}</span>
                  <span className="text-sm text-muted-foreground">{e.org}</span>
                </div>
                <p className="text-xs tabular-nums text-muted-foreground">{e.period}</p>
                {e.desc && <p className="whitespace-pre-wrap text-sm">{e.desc}</p>}
              </li>
            ))}
          </ol>
        </Section>
      </div>

      <Section id="projects" title="포트폴리오" empty={false}>
        {!p.projects.length && <p className="text-sm text-muted-foreground">아직 넣은 프로젝트가 없습니다. 아래 허브 프로젝트에서 고르거나 편집에서 직접 추가하세요.</p>}
        <div className="grid gap-4 md:grid-cols-2">
          {p.projects.map((x, i) => {
            const hub = x.projectId ? projectName.get(x.projectId) : null;
            const files = hub ? projectItemList(db, hub.id, { limit: 3 }) : null;
            return (
              <article key={i} className="flex min-w-0 flex-col gap-2 rounded-lg border p-4">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <h3 className="font-semibold">{x.title || "(이름 없음)"}</h3>
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">{x.period}</span>
                </div>
                {x.role && <p className="text-sm text-muted-foreground">{x.role}</p>}
                {x.tech && (
                  <div className="flex flex-wrap gap-1">
                    {chips(x.tech).map((c) => (
                      <Badge key={c} variant="outline">
                        {c}
                      </Badge>
                    ))}
                  </div>
                )}
                {x.summary ? (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{x.summary}</p>
                ) : (
                  <Link href={`/profile/edit#projects`} className="text-sm text-muted-foreground underline">
                    설명을 적어 주세요
                  </Link>
                )}
                {/* 허브 자료: 이 프로젝트의 노트·파일·저장소 */}
                {hub && files && (
                  <div className="mt-auto space-y-1 rounded-md bg-muted/50 p-2 text-sm">
                    <Link href={`/projects/${hub.id}`} className="flex items-center gap-1.5 font-medium hover:underline">
                      <FolderKanban className="size-4" /> 허브 자료 {files.total.toLocaleString()}개 보기
                    </Link>
                    {files.items.map((f) => (
                      <Link key={f.id} href={`/items/${f.id}`} className="flex items-center gap-2 pl-0.5 text-xs hover:underline">
                        <SourceIcon kind={f.sourceKind} />
                        <span className="truncate">{f.title}</span>
                        <span className="ml-auto shrink-0 text-muted-foreground">{relTime(f.modifiedAt)}</span>
                      </Link>
                    ))}
                  </div>
                )}
                {x.projectId && !hub && <p className="text-xs text-destructive">연결한 허브 프로젝트가 없어졌습니다. 편집에서 다시 고르세요.</p>}
                {linkHref(x.url) && (
                  <a href={linkHref(x.url)} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sm underline-offset-2 hover:underline">
                    <ExternalLink className="size-3.5" /> {x.url}
                  </a>
                )}
              </article>
            );
          })}
        </div>
        {candidates.length > 0 && (
          <details className="rounded-lg border p-3 text-sm" open={!p.projects.length}>
            <summary className="cursor-pointer font-medium">허브 프로젝트에서 고르기 ({candidates.length})</summary>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              {candidates.map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  <Link href={`/projects/${c.id}`} className="min-w-0 flex-1 truncate hover:underline">
                    {c.name}
                  </Link>
                  <form action={addHubProject.bind(null, c.id)}>
                    <Button type="submit" variant="ghost" size="sm" className="h-7 text-xs">
                      <Plus className="size-3.5" /> 넣기
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Section>
    </div>
  );
}
