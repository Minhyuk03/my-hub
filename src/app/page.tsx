import { Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { CoverImage } from "@/components/cover-image";
import { HeroFx, heroBackdropStyle, heroTextStyle } from "@/components/hero-fx";
import { Button } from "@/components/ui/button";
import { getDb } from "@/server/db";
import { projects } from "@/server/db/schema";
import { imagePos, imageSrc, linkHref, normalizeProfile, stars, type Profile } from "@/server/profile";
import { membershipSql, projectItemList } from "@/server/projects";
import { getSettings } from "@/server/settings";
import { addHubProject, removeProfileProject } from "./profile/actions";
import { ConfirmSubmit } from "./settings/confirm-submit";

// 아임웹 MULTIPLY 테마 느낌: 화면 끝까지 닿는 배경 사진 위 큰 가는 글씨(맨 위 메뉴 줄이 투명하게 겹침).
// 배경 사진은 끝까지 화면에 붙어 있고, 아래 내용은 반투명 판으로 그 위에 떠오른다(사진은 흐려진 채 계속 보임)
// → About → Profile → Project 사진 격자 → 짙은 회색 연락처 띠. 글꼴·색은 layout.tsx·globals.css 공통 (--taupe, --footer).

/** 사진 위에 떠 있는 반투명 판 (흐린 사진이 비쳐 보임) */
const panel = "rounded-sm bg-background/80 p-6 shadow-2xl backdrop-blur-md sm:p-10";

/** 한 화면 = 한 섹션: 스크롤하면 다음 섹션이 화면 가운데로 딱 맞춰 온다 (hero-fx 가 이 페이지에서만 스냅을 켬).
 * 화면보다 긴 섹션(휴대폰의 Project 등)은 그 안에서 그대로 스크롤된다 */
const slide = "flex min-h-[100svh] snap-start snap-always flex-col justify-center gap-6 py-24";

/** 본문 폭을 벗어나 화면 끝까지 닿게 (body 가 overflow-x: clip) */
const bleed = "relative left-1/2 w-screen -translate-x-1/2";

/** 넓은 자간의 작은 대문자 라벨 */
const label = "text-[11px] font-medium uppercase tracking-[0.25em]";

/** 가운데 정렬 섹션 제목 (Our Project 처럼) */
function Title({ id, en, ko }: { id: string; en: string; ko: string }) {
  return (
    <div id={id} className="scroll-mt-20 space-y-2 text-center">
      <h2 className="text-2xl font-normal tracking-[0.2em]">{en}</h2>
      <p className="text-xs text-muted-foreground">{ko}</p>
    </div>
  );
}

/** 비어 있는 칸: 옅은 글씨, 누르면 편집 화면의 그 섹션으로 */
function Empty({ to, children = "편집에서 추가" }: { to: string; children?: React.ReactNode }) {
  return (
    <Link href={`/profile/edit#${to}`} className="text-sm text-muted-foreground/70 hover:text-foreground hover:underline">
      {children}
    </Link>
  );
}

function Dots({ n }: { n: number }) {
  return (
    <span className="inline-flex gap-1" aria-label={`5점 중 ${n}점`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`size-1.5 rounded-full ${i <= n ? "bg-[var(--taupe)]" : "bg-muted-foreground/25"}`} />
      ))}
    </span>
  );
}

/** 프로필 칸 하나 (EDUCATION 같은 작은 라벨 + 내용) */
function Block({ title, to, empty, children }: { title: string; to: string; empty: boolean; children: React.ReactNode }) {
  return (
    <section className="min-w-0 space-y-4">
      <h3 className={`${label} text-[var(--taupe)]`}>{title}</h3>
      {empty ? <Empty to={to} /> : children}
    </section>
  );
}

/** 사진 자리: 사진이 없으면 "사진 넣기" 안내 칸 */
function Photo({ src, pos, className, hint = "사진 넣기", dark = false }: { src: string; pos?: string; className: string; hint?: string; dark?: boolean }) {
  if (src) return <CoverImage src={src} position={pos} className={className} />;
  return (
    <Link
      href="/profile/edit#basics"
      className={`flex items-center justify-center border border-dashed text-xs ${dark ? "border-white/30 text-white/60 hover:bg-white/10" : "border-muted-foreground/30 text-muted-foreground hover:bg-muted"} ${className}`}
    >
      {hint}
    </Link>
  );
}

const chips = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const lines = (s: string) =>
  s
    .split("\n")
    .map((x) => x.replace(/^\s*[-•·]\s*/, "").trim())
    .filter(Boolean);

export default async function ProfilePage({ searchParams }: PageProps<"/">) {
  await connection();
  const filter = (await searchParams).t;
  const db = getDb();
  const p: Profile = normalizeProfile(getSettings(db).profile);
  const allProjects = db.select().from(projects).all();
  const hubById = new Map(allProjects.map((x) => [x.id, x]));

  /** 표지 사진을 안 정했으면 연결한 허브 프로젝트의 가장 최근 이미지 (이 Mac 에 있는 파일 먼저) */
  const hubCover = (projectId: number) => {
    const m = membershipSql(db, projectId);
    const id = db.$client
      .prepare(
        `SELECT i.id FROM items i JOIN sources s ON s.id = i.source_id WHERE i.id IN (${m.sql}) AND i.kind = 'image' AND i.state = 'ok'
         ORDER BY s.kind IN ('gdrive', 'notion', 'github', 'figma'), i.modified_at DESC LIMIT 1`,
      )
      .pluck()
      .get(...m.params) as number | undefined;
    return id ? `/api/items/${id}/file` : "";
  };
  const works = p.projects.map((x, index) => {
    const hub = x.projectId ? hubById.get(x.projectId) : undefined;
    return {
      ...x,
      index,
      hub,
      cover: imageSrc(x.cover) || (hub ? hubCover(hub.id) : ""),
      coverPos: imageSrc(x.cover) ? imagePos(x.cover) : undefined,
      files: hub ? projectItemList(db, hub.id, { limit: 1 }).total : 0,
    };
  });
  // 프로젝트 필터 탭: 프로젝트들의 기술 (많이 쓴 순, 최대 6개)
  const techCount = new Map<string, number>();
  for (const w of works) for (const t of chips(w.tech)) techCount.set(t, (techCount.get(t) ?? 0) + 1);
  const tabs = [...techCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t);
  const active = typeof filter === "string" && tabs.includes(filter) ? filter : null;
  const shown = active ? works.filter((w) => chips(w.tech).includes(active)) : works;

  const linked = new Set(p.projects.map((x) => x.projectId));
  const candidates = allProjects
    .filter((x) => x.kind === "project" && !linked.has(x.id))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 12);

  const hero = imageSrc(p.hero);
  const photo = imageSrc(p.photo);
  const heroPos = imagePos(p.hero);
  const photoPos = imagePos(p.photo);
  const aboutWork = works.find((w) => w.cover);
  const aboutSecond = aboutWork?.cover ?? "";
  const brand = (p.nameEn || p.name || "My Hub").toUpperCase();
  const skills = [...p.skills].sort((a, b) => stars(b.level) - stars(a.level));
  const blank = !p.name && !p.headline && !p.about && !p.projects.length;

  return (
    <div className="relative -mt-6 -mb-6 font-light">
      {/* 맨 위 멈춤 자리 (붙어 있는 사진 칸은 스냅 기준으로 쓰지 않는다) */}
      <div aria-hidden data-snap className="absolute top-0 h-px w-px snap-start snap-always" />
      {/* 배경 사진 + 이름: 화면에 붙어 있고(맨 위 메뉴 줄이 투명하게 겹침), 아래 내용이 올라오면 흐려진다 */}
      {/* sticky 에서는 left 가 붙는 기준이 되므로 화면 끝까지 늘리기를 여백으로 한다 */}
      <HeroFx className="sticky top-0 isolate z-0 ml-[calc(50%-50vw)] w-screen overflow-hidden bg-neutral-700 text-white">
        <div className="absolute inset-0 -z-20" style={heroBackdropStyle}>
          {hero ? <CoverImage src={hero} position={heroPos} className="size-full" /> : <div className="size-full bg-gradient-to-br from-stone-500 via-stone-600 to-stone-800" />}
        </div>
        <div className="absolute inset-0 -z-10 bg-black/35" />
        <div className="mx-auto grid min-h-[100svh] max-w-6xl items-center gap-10 px-4 pt-32 pb-16 md:grid-cols-[1fr_22rem]" style={heroTextStyle}>
          <div className="space-y-5">
            <h1 className="text-4xl leading-tight font-light text-balance sm:text-5xl">{p.name || "이름을 적어 주세요"}</h1>
            <p className="max-w-[40ch] text-base leading-relaxed text-white/90">{p.headline || "한 줄 소개를 적어 주세요"}</p>
            {/* 이 화면 안 바로가기 */}
            <div className={`${label} flex flex-wrap gap-x-6 gap-y-2 pt-6 font-normal text-white/75`}>
              <a href="#about" className="hover:text-white">
                About
              </a>
              <a href="#profile" className="hover:text-white">
                Profile
              </a>
              <a href="#project" className="hover:text-white">
                Project
              </a>
              <a href="#contact" className="hover:text-white">
                Contact
              </a>
              <Link href="/profile/edit" className="inline-flex items-center gap-1 normal-case tracking-normal hover:text-white">
                <Pencil className="size-3" /> 편집
              </Link>
              {!hero && (
                <Link href="/profile/edit#basics" className="normal-case tracking-normal hover:text-white">
                  배경 사진 넣기
                </Link>
              )}
            </div>
          </div>
          {/* 오른쪽에 겹쳐 놓인 사진 (테마의 슬라이드 자리) */}
          <div className="hidden md:block">
            <Photo src={photo} pos={photoPos} hint="프로필 사진 넣기" dark className="aspect-[4/5] w-full shadow-2xl" />
          </div>
        </div>
      </HeroFx>

      {/* 아래 내용: 배경 사진 위로 떠오르는 반투명 판들 (사진은 뒤에 계속 보인다) */}
      <div className={`${bleed} z-10`}>
        <div className="mx-auto max-w-6xl px-4">
          {/* About 화면 (비어 있으면 안내도 함께) */}
          <div data-snap className={slide}>
            {blank && (
              <p className={`${panel} text-center text-sm text-muted-foreground sm:py-6`}>
                아직 비어 있습니다.{" "}
                <Link href="/profile/edit" className="underline">
                  편집
                </Link>
                에서 채우고, 아래 &ldquo;허브 프로젝트에서 고르기&rdquo;로 작업을 넣어 보세요. 즐겨찾기·일정은{" "}
                <Link href="/hub" className="underline">
                  허브
                </Link>
                에 있습니다.
              </p>
            )}

            {/* About: 왼쪽 엇갈린 사진 두 장, 오른쪽 정렬 글 */}
            <section id="about" className={`${panel} grid scroll-mt-20 items-center gap-12 md:grid-cols-2`}>
              <div className="grid grid-cols-2 items-start gap-4">
                <Photo src={photo} pos={photoPos} className="aspect-[3/4] w-full" />
                <Photo src={aboutSecond || hero} pos={aboutSecond ? aboutWork?.coverPos : heroPos} hint="프로젝트 표지나 배경 사진이 여기 보입니다" className="mt-16 aspect-square w-full p-4 text-center" />
              </div>
              <div className="space-y-6 md:text-right">
                <h2 className="text-2xl font-normal tracking-[0.2em]">About me :</h2>
                {p.about ? (
                  <p className="text-sm leading-7 whitespace-pre-wrap text-muted-foreground md:ml-auto md:max-w-[46ch]">{p.about}</p>
                ) : (
                  <Empty to="about">자기소개를 3~5문장으로 적어 주세요</Empty>
                )}
                <a href="#project" className={`${label} inline-block bg-[var(--taupe)] px-5 py-2.5 font-normal text-white hover:opacity-90`}>
                  Project
                </a>
              </div>
            </section>
          </div>


          {/* Profile: 교육·경력·자격증 / 스킬·언어·경험 */}
          {/* Profile 화면 */}
          <div data-snap className={slide}>
            <section className={`${panel} space-y-14`}>
              <Title id="profile" en="Profile" ko="교육 · 경력 · 스킬" />
              <div className="grid gap-x-12 gap-y-14 md:grid-cols-3">
                <Block title="Education" to="education" empty={!p.education.length}>
                  <ul className="space-y-5 text-sm">
                    {p.education.map((e, i) => (
                      <li key={i} className="space-y-1">
                        <p className="text-xs tabular-nums text-muted-foreground">{e.period}</p>
                        <p className="font-normal">{e.school}</p>
                        {e.major && <p className="text-muted-foreground">{e.major}</p>}
                        {e.note && <p className="text-xs text-muted-foreground">{e.note}</p>}
                      </li>
                    ))}
                  </ul>
                </Block>
                <Block title="Experience" to="experience" empty={!p.experience.length}>
                  <ul className="space-y-5 text-sm">
                    {p.experience.map((e, i) => (
                      <li key={i} className="space-y-1">
                        <p className="text-xs tabular-nums text-muted-foreground">{e.period}</p>
                        <p className="font-normal">
                          {e.org}
                          {e.title && <span className="text-muted-foreground"> · {e.title}</span>}
                        </p>
                        {lines(e.desc).map((d, j) => (
                          <p key={j} className="text-xs leading-5 text-muted-foreground">
                            — {d}
                          </p>
                        ))}
                      </li>
                    ))}
                  </ul>
                </Block>
                <Block title="Awards" to="awards" empty={!p.awards.length}>
                  <ul className="space-y-3 text-sm">
                    {p.awards.map((a, i) => (
                      <li key={i} className="space-y-0.5">
                        <p className="text-xs tabular-nums text-muted-foreground">{a.date}</p>
                        <p className="font-normal">{a.title}</p>
                        {a.org && <p className="text-xs text-muted-foreground">{a.org}</p>}
                      </li>
                    ))}
                  </ul>
                </Block>
                <Block title="Skills" to="skills" empty={!skills.length}>
                  <ul className="space-y-3 text-sm">
                    {skills.map((s, i) => (
                      <li key={i} className="space-y-1">
                        <div className="flex items-center gap-3">
                          <span className="font-normal">{s.name}</span>
                          <span className="ml-auto">
                            <Dots n={stars(s.level)} />
                          </span>
                        </div>
                        {s.desc && <p className="text-xs text-muted-foreground">{s.desc}</p>}
                      </li>
                    ))}
                  </ul>
                </Block>
                <Block title="Languages" to="languages" empty={!p.languages.length}>
                  <ul className="space-y-3 text-sm">
                    {p.languages.map((l, i) => (
                      <li key={i} className="flex items-center gap-3">
                        <span className="font-normal">{l.name}</span>
                        <span className="ml-auto">
                          <Dots n={stars(l.level)} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </Block>
                <Block title="Activities" to="activities" empty={!p.activities.length}>
                  <ul className="space-y-3 text-sm">
                    {p.activities.map((a, i) => (
                      <li key={i} className="space-y-0.5">
                        <p className="text-xs tabular-nums text-muted-foreground">{a.date}</p>
                        <p className="font-normal">{a.title}</p>
                        {a.org && <p className="text-xs text-muted-foreground">{a.org}</p>}
                      </li>
                    ))}
                  </ul>
                </Block>
              </div>
            </section>
          </div>


          {/* Project: 기술 탭 + 사진 격자. 누르면 허브 프로젝트로 */}
          {/* Project 화면 */}
          <div data-snap className={slide}>
            <section className={`${panel} space-y-10`}>
              <Title id="project" en="Project" ko="허브에 모아 둔 작업" />
              {tabs.length > 1 && (
                <nav className={`${label} flex flex-wrap justify-center gap-x-8 gap-y-2 font-normal text-muted-foreground`}>
                  <Link href="/#project" scroll={false} className={!active ? "text-foreground" : "hover:text-foreground"}>
                    All
                  </Link>
                  {tabs.map((t) => (
                    <Link key={t} href={`/?t=${encodeURIComponent(t)}#project`} scroll={false} className={active === t ? "text-foreground" : "hover:text-foreground"}>
                      {t}
                    </Link>
                  ))}
                </nav>
              )}
              {!works.length && (
                <p className="text-center">
                  <Empty to="projects">아래 허브 프로젝트에서 고르거나 편집에서 추가하세요</Empty>
                </p>
              )}
              <div className="columns-1 gap-5 sm:columns-2 lg:columns-3">
                {shown.map((w, i) => {
                  const href = w.hub ? `/projects/${w.hub.id}` : linkHref(w.url) || "/profile/edit#projects";
                  const external = !w.hub && !!linkHref(w.url);
                  return (
                    <figure key={i} className="mb-8 break-inside-avoid">
                      <a href={href} target={external ? "_blank" : undefined} rel="noreferrer" className="group relative block overflow-hidden bg-muted">
                        {w.cover ? (
                          <CoverImage src={w.cover} position={w.coverPos} className={`w-full transition-transform duration-500 group-hover:scale-105 ${i % 3 === 1 ? "aspect-[4/5]" : "aspect-[4/3]"}`} />
                        ) : (
                          <div className={`flex w-full items-center justify-center bg-stone-200 p-6 text-center text-stone-500 dark:bg-stone-800 dark:text-stone-400 ${i % 3 === 1 ? "aspect-[4/5]" : "aspect-[4/3]"}`}>
                            <span className="tracking-[0.15em]">{w.title || "Project"}</span>
                          </div>
                        )}
                        {/* 올리면 보이는 설명 */}
                        <div className="absolute inset-0 flex flex-col justify-end gap-1 bg-black/55 p-5 text-sm text-white opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                          {w.role && <p className="text-white/80">{w.role}</p>}
                          {w.contribution && <p className="text-white/80">기여도 {w.contribution}</p>}
                          {w.result && <p>✓ {w.result}</p>}
                          {w.summary && <p className="line-clamp-3 text-xs text-white/80">{w.summary}</p>}
                        </div>
                      </a>
                      <figcaption className="mt-3 space-y-1">
                        <p className="font-normal">{w.title || w.hub?.name || "(이름 없음)"}</p>
                        <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                          {w.period && <span className="tabular-nums">{w.period}</span>}
                          {w.tech && <span>{chips(w.tech).join(" · ")}</span>}
                        </p>
                        {w.hub && (
                          <Link href={`/projects/${w.hub.id}`} className={`${label} inline-block text-[10px] text-[var(--taupe)] hover:underline`}>
                            허브 자료 {w.files.toLocaleString()} →
                          </Link>
                        )}
                        {w.projectId && !w.hub && <p className="text-xs text-destructive">연결한 허브 프로젝트가 없어졌습니다. 편집에서 다시 고르세요.</p>}
                        <form action={removeProfileProject.bind(null, w.index, w.title)}>
                          <ConfirmSubmit
                            message={`'${w.title || w.hub?.name || "이름 없음"}'을(를) 자기소개 Project 에서 뺄까요? 적어 둔 설명도 함께 지워집니다. 허브 프로젝트와 파일은 그대로 남습니다.`}
                            className="-ml-2 h-6 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                          >
                            빼기
                          </ConfirmSubmit>
                        </form>
                      </figcaption>
                    </figure>
                  );
                })}
              </div>
              {candidates.length > 0 && (
                <details className="mx-auto max-w-3xl border-t pt-4 text-sm" open={!p.projects.length}>
                  <summary className="cursor-pointer text-center text-muted-foreground">허브 프로젝트에서 고르기 ({candidates.length})</summary>
                  <ul className="mt-4 grid gap-1 sm:grid-cols-2">
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
            </section>
          </div>
        </div>
      </div>

      {/* Contact: 짙은 회색 띠 */}
      <footer id="contact" data-snap className={`${bleed} z-10 snap-end bg-[var(--footer)]/90 text-sm text-white/70 backdrop-blur-md`}>
        <div className="mx-auto flex max-w-6xl flex-wrap gap-x-16 gap-y-8 px-4 py-14">
          <div className="space-y-3">
            <p className="text-xl font-normal tracking-[0.3em] text-white">{brand}</p>
            {p.links.length ? (
              <ul className="space-y-1">
                {p.links.map((l, i) => {
                  const href = linkHref(l.url);
                  return (
                    <li key={i}>
                      {l.label && <span className="text-white/50">{l.label} </span>}
                      {href ? (
                        <a href={href} className="break-all text-white/80 hover:text-white">
                          {l.url}
                        </a>
                      ) : (
                        <span className="break-all">{l.url}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Link href="/profile/edit#links" className="text-white/50 hover:text-white hover:underline">
                연락처를 적어 주세요
              </Link>
            )}
            <p className="text-xs text-white/40">
              © {new Date().getFullYear()} {p.name || brand}
            </p>
          </div>
          <ul className={`${label} ml-auto flex flex-wrap content-start gap-x-6 gap-y-2 font-normal`}>
            {p.sns.length ? (
              p.sns.map((s, i) => {
                const href = linkHref(s.url);
                return (
                  <li key={i}>
                    {href ? (
                      <a href={href} target="_blank" rel="noreferrer" title={s.desc || s.url} className="hover:text-white">
                        {s.title || s.url}
                      </a>
                    ) : (
                      s.title
                    )}
                  </li>
                );
              })
            ) : (
              <li>
                <Link href="/profile/edit#sns" className="normal-case tracking-normal text-white/50 hover:text-white hover:underline">
                  SNS 넣기
                </Link>
              </li>
            )}
          </ul>
        </div>
      </footer>
    </div>
  );
}
