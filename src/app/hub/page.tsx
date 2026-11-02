import { Clock, Download, ExternalLink, Folder, FolderKanban, FolderOpen, Pencil, Star } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { eq } from "drizzle-orm";
import { CoverImage } from "@/components/cover-image";
import { Agenda } from "@/components/home/agenda";
import { SourceIcon } from "@/components/hub-ui";
import { buttonVariants } from "@/components/ui/button";
import { bytes, fullDate, relTime, shortPath } from "@/lib/format";
import { KIND_LABEL } from "@/lib/labels";
import { categoryCounts, folderTrail, folderTree, listFiles, type Place, type Sort } from "@/server/browse";
import type { CalendarSnapshot } from "@/server/calendar";
import { CATEGORIES, CATEGORY_LABEL, type Category } from "@/server/category-labels";
import { driveExpiry } from "@/server/connectors/gdrive/client";
import { getDb } from "@/server/db";
import { runtime } from "@/server/db/schema";
import { tiles } from "@/server/home";
import { activeProjects } from "@/server/projects";
import { getItem } from "@/server/queries";
import { getSettings } from "@/server/settings";
import { FileList } from "./file-list";
import { FolderTree } from "./folder-tree";

// 허브 = 파일 탐색: 왼쪽(바로가기·분류·소스 폴더 나무) | 가운데(위치·하위 폴더·파일 목록) | 오른쪽(미리보기, 없으면 일정·이어서 작업)

const PAGE = 100;
const SORTS: Record<Sort, string> = { date: "최근 수정", name: "이름", size: "크기" };
const CLOUD = new Set(["gdrive", "notion", "github", "figma"]);
const side = "text-[11px] font-normal uppercase tracking-[0.25em] text-primary";

function SideLink({ href, active, icon, label, count }: { href: string; active: boolean; icon: React.ReactNode; label: string; count?: number }) {
  return (
    <Link href={href} className={`flex items-center gap-2 rounded-sm px-2 py-1 text-sm ${active ? "bg-primary/10" : "text-foreground/80 hover:bg-muted"}`} aria-current={active ? "page" : undefined}>
      {icon}
      <span className="truncate">{label}</span>
      {count != null && <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{count.toLocaleString()}</span>}
    </Link>
  );
}

export default async function HubPage({ searchParams }: PageProps<"/hub">) {
  await connection();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const db = getDb();
  const s = getSettings(db);

  // 지금 위치: ?f=폴더 / ?c=분류 / ?t=태그 / 없으면 최근 30일
  const folderId = Number(one("f")) || null;
  const cat = (CATEGORIES as readonly string[]).includes(one("c")) ? (one("c") as Category) : null;
  const tag = one("t") || null;
  const place: Place = folderId ? { kind: "folder", id: folderId } : cat ? { kind: "category", category: cat } : tag ? { kind: "tag", tag } : { kind: "recent" };
  const sort: Sort = one("sort") in SORTS ? (one("sort") as Sort) : "date";
  const page = Math.max(1, Number(one("page")) || 1);
  const itemId = Number(one("item")) || null;

  const tree = folderTree(db);
  const trail = folderId ? folderTrail(tree.nodes, folderId) : [];
  const subfolders = folderId ? tree.nodes.filter((n) => n.parentId === folderId) : [];
  const list = listFiles(db, place, { sort, limit: PAGE, offset: (page - 1) * PAGE });
  const cats = categoryCounts(db);
  const favorites = tiles(db).filter((t) => t.kind !== "url");
  const working = activeProjects(db, 6);
  const item = itemId ? getItem(db, itemId) : null;

  // 주소: 지금 위치를 지키고 일부만 바꾼다
  const here = (patch: Record<string, string | number | null>) => {
    const u = new URLSearchParams();
    if (folderId) u.set("f", String(folderId));
    if (cat) u.set("c", cat);
    if (tag) u.set("t", tag);
    if (sort !== "date") u.set("sort", sort);
    if (page > 1) u.set("page", String(page));
    if (itemId) u.set("item", String(itemId));
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") u.delete(k);
      else u.set(k, String(v));
    }
    return `/hub${u.size ? `?${u}` : ""}`;
  };
  const itemHref = Object.fromEntries(list.rows.map((r) => [r.id, here({ item: r.id })]));
  const title =
    place.kind === "folder" ? (trail.at(-1)?.name ?? "폴더") : place.kind === "category" ? CATEGORY_LABEL[place.category] : place.kind === "tag" ? `#${place.tag}` : "최근 30일 수정";

  const calendar = s.calendarEnabled ? ((db.select().from(runtime).where(eq(runtime.key, "calendar")).get()?.value as CalendarSnapshot | undefined) ?? null) : null;
  const exp = driveExpiry(s.gdriveAccount, s.gdriveTestingMode);
  const driveOffline = tree.sources.some((x) => x.kind === "gdrive" && x.status === "offline");
  const driveNotice = driveOffline
    ? "Google Drive 연결이 만료되었습니다. 가져온 내용은 그대로 보이지만 원본은 열 수 없습니다."
    : exp?.soon
      ? `Google Drive 연결이 ${exp.leftDays <= 1 ? "곧" : `${exp.leftDays}일 후`} 만료됩니다.`
      : null;

  const sidebar = (
    <nav className="space-y-6" aria-label="파일 위치">
      <section className="space-y-1">
        <h2 className={side}>Quick</h2>
        <SideLink href="/hub" active={place.kind === "recent"} icon={<Clock className="size-3.5 text-muted-foreground" />} label="최근 수정" />
        {favorites.map((t) => (
          <SideLink
            key={t.id}
            href={t.kind === "folder" ? `/hub?f=${t.href.match(/\/folders\/(\d+)/)?.[1] ?? ""}` : t.href}
            active={t.kind === "folder" && t.href === `/folders/${folderId}`}
            icon={t.kind === "project" ? <FolderKanban className="size-3.5 text-muted-foreground" /> : <Star className="size-3.5 text-muted-foreground" />}
            label={t.title}
          />
        ))}
        <Link href="/home/edit#tiles" className="block px-2 py-1 text-xs text-muted-foreground hover:underline">
          + 즐겨찾기 추가
        </Link>
      </section>
      {working.length > 0 && (
        <section className="space-y-1">
          <h2 className={side}>Working on</h2>
          {working.map((p) => (
            <SideLink key={p.id} href={`/projects/${p.id}`} active={false} icon={<FolderKanban className="size-3.5 text-muted-foreground" />} label={p.name} count={p.recentCount} />
          ))}
        </section>
      )}
      <section className="space-y-1">
        <h2 className={side}>Category</h2>
        {CATEGORIES.map((c) => (
          <SideLink key={c} href={`/hub?c=${c}`} active={cat === c} icon={<span className="size-2 rounded-full bg-primary/60" />} label={CATEGORY_LABEL[c]} count={cats[c]} />
        ))}
      </section>
      <section className="space-y-1">
        <h2 className={side}>Sources</h2>
        <FolderTree sources={tree.sources} nodes={tree.nodes} current={folderId} open={trail.slice(0, -1).map((n) => n.id).concat(folderId ? [folderId] : [])} />
      </section>
    </nav>
  );

  return (
    <div className="space-y-4">
      {driveNotice && (
        <Link href="/settings#gdrive" className="block rounded-sm bg-amber-500/15 px-3 py-2 text-sm hover:bg-amber-500/25">
          {driveNotice} → 설정에서 다시 연결
        </Link>
      )}
      <div className="grid gap-6 md:grid-cols-[15rem_minmax(0,1fr)] lg:grid-cols-[15rem_minmax(0,1fr)_19rem]">
        {/* 왼쪽: 넓은 화면에서는 붙어 있고, 좁은 화면에서는 접어 둔다 */}
        <aside className="hidden md:block">
          <div className="sticky top-20 max-h-[calc(100dvh-6rem)] overflow-y-auto pr-1">{sidebar}</div>
        </aside>
        <details className="rounded-sm border p-3 md:hidden">
          <summary className="cursor-pointer text-sm">위치 고르기 · {title}</summary>
          <div className="mt-4">{sidebar}</div>
        </details>

        {/* 가운데: 위치·하위 폴더·파일 */}
        <section className="min-w-0 space-y-4">
          <div className="space-y-1">
            {trail.length > 1 && (
              <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                {trail.slice(0, -1).map((n) => (
                  <span key={n.id} className="flex items-center gap-1">
                    <Link href={`/hub?f=${n.id}`} className="hover:text-foreground hover:underline">
                      {n.name}
                    </Link>
                    <span>/</span>
                  </span>
                ))}
              </p>
            )}
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-2xl font-light">{title}</h1>
              <span className="text-xs text-muted-foreground">
                파일 {list.total.toLocaleString()}개{place.kind === "folder" && subfolders.length > 0 && ` · 폴더 ${subfolders.length}개`}
              </span>
              <span className="ml-auto flex gap-1 text-xs">
                {(Object.keys(SORTS) as Sort[]).map((k) => (
                  <Link key={k} href={here({ sort: k === "date" ? null : k, page: null })} scroll={false} className={`rounded-full border px-2 py-0.5 ${k === sort ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>
                    {SORTS[k]}
                  </Link>
                ))}
              </span>
            </div>
            {place.kind === "folder" && (
              <p className="flex flex-wrap gap-3 text-xs">
                <Link href={`/folders/${folderId}`} className="text-muted-foreground hover:text-foreground hover:underline">
                  폴더 화면 (프로젝트 연결·즐겨찾기·Finder)
                </Link>
                <Link href={`/search?source=${tree.nodes.find((n) => n.id === folderId)?.sourceId ?? ""}`} className="text-muted-foreground hover:text-foreground hover:underline">
                  이 소스에서 검색
                </Link>
              </p>
            )}
          </div>

          {subfolders.length > 0 && (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
              {subfolders.map((d) => (
                <li key={d.id}>
                  <Link href={`/hub?f=${d.id}`} className="flex items-center gap-2 rounded-sm border px-2.5 py-2 text-sm hover:bg-muted">
                    <Folder className="size-4 shrink-0 text-primary/70" />
                    <span className="truncate">{d.name}</span>
                    <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">{d.total.toLocaleString()}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <FileList rows={list.rows} selected={itemId} itemHref={itemHref} />

          {list.total > PAGE && (
            <div className="flex items-center gap-3 text-sm">
              {page > 1 && (
                <Link href={here({ page: page - 1 === 1 ? null : page - 1, item: null })} className="underline">
                  ← 이전
                </Link>
              )}
              <span className="text-xs text-muted-foreground">
                {(page - 1) * PAGE + 1}–{Math.min(page * PAGE, list.total)} / {list.total.toLocaleString()}
              </span>
              {page * PAGE < list.total && (
                <Link href={here({ page: page + 1, item: null })} className="underline">
                  다음 →
                </Link>
              )}
            </div>
          )}
        </section>

        {/* 오른쪽: 고른 파일 미리보기, 없으면 일정·이어서 작업 */}
        <aside className="hidden lg:block">
          <div className="sticky top-20 max-h-[calc(100dvh-6rem)] space-y-5 overflow-y-auto">
            {item ? (
              <div className="space-y-4">
                <div className="flex items-start gap-2">
                  <SourceIcon kind={item.source.kind} className="mt-1 size-4" />
                  <h2 className="min-w-0 flex-1 text-base font-normal break-all">{item.item.title}</h2>
                  <Link href={here({ item: null })} scroll={false} className="text-xs text-muted-foreground hover:underline" aria-label="미리보기 닫기">
                    닫기
                  </Link>
                </div>
                {item.item.state === "cloud_only" ? (
                  <div className="rounded-sm bg-muted p-3 text-xs text-muted-foreground">iCloud 에만 있는 파일입니다. &ldquo;열기&rdquo;를 누르면 이 Mac 으로 내려받아 보여 줍니다.</div>
                ) : item.item.kind === "image" ? (
                  CLOUD.has(item.source.kind) ? (
                    <div className="flex aspect-video items-center justify-center rounded-sm bg-muted text-xs text-muted-foreground">클라우드 사진은 열어서 보세요</div>
                  ) : (
                    <CoverImage src={`/api/items/${item.item.id}/file`} alt={item.item.title} className="max-h-72 w-full rounded-sm bg-muted object-contain" />
                  )
                ) : item.body ? (
                  <p className="max-h-72 overflow-hidden rounded-sm bg-muted/60 p-3 text-xs leading-5 whitespace-pre-wrap text-muted-foreground">{item.body.slice(0, 1200)}</p>
                ) : (
                  <p className="rounded-sm bg-muted/60 p-3 text-xs text-muted-foreground">미리 볼 글이 없습니다.</p>
                )}
                <dl className="grid grid-cols-[4rem_1fr] gap-x-2 gap-y-1 text-xs">
                  <dt className="text-muted-foreground">종류</dt>
                  <dd>
                    {KIND_LABEL[item.item.kind] ?? item.item.kind} · {item.item.ext}
                  </dd>
                  <dt className="text-muted-foreground">크기</dt>
                  <dd>{bytes(item.item.size)}</dd>
                  <dt className="text-muted-foreground">수정</dt>
                  <dd>{fullDate(item.item.modifiedAt)}</dd>
                  <dt className="text-muted-foreground">위치</dt>
                  <dd className="break-all">{shortPath(item.item.path)}</dd>
                  {item.tags.length > 0 && (
                    <>
                      <dt className="text-muted-foreground">태그</dt>
                      <dd className="flex flex-wrap gap-1">
                        {item.tags.map((t) => (
                          <Link key={t} href={`/hub?t=${encodeURIComponent(t)}`} className="rounded-sm bg-muted px-1.5 hover:underline">
                            #{t}
                          </Link>
                        ))}
                      </dd>
                    </>
                  )}
                </dl>
                <div className="flex flex-wrap gap-2">
                  <Link href={`/items/${item.item.id}`} className={buttonVariants({ size: "sm" })}>
                    <ExternalLink className="size-3.5" /> 열기
                  </Link>
                  <a href={`/api/items/${item.item.id}/file?download=1`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                    <Download className="size-3.5" /> 내려받기
                  </a>
                  {item.item.folderId && item.item.folderId !== folderId && (
                    <Link href={`/hub?f=${item.item.folderId}&item=${item.item.id}`} className={buttonVariants({ size: "sm", variant: "ghost" })}>
                      <FolderOpen className="size-3.5" /> 폴더로
                    </Link>
                  )}
                </div>
              </div>
            ) : (
              <>
                <p className="text-xs text-muted-foreground">파일을 누르면 여기에서 미리 봅니다.</p>
                {s.calendarEnabled && (
                  <section className="space-y-2">
                    <h2 className={side}>Schedule</h2>
                    <Agenda snap={calendar} hidden={s.calendarHidden} />
                  </section>
                )}
                {working.length > 0 && (
                  <section className="space-y-2">
                    <h2 className={side}>Continue</h2>
                    <ul className="space-y-1 text-sm">
                      {working.map((p) => (
                        <li key={p.id}>
                          <Link href={`/projects/${p.id}`} className="flex gap-2 hover:underline">
                            <span className="truncate">{p.name}</span>
                            <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                              {p.recentCount}개 · {relTime(p.lastModified)}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                <Link href="/profile/edit" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:underline">
                  <Pencil className="size-3" /> 포트폴리오 편집
                </Link>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
