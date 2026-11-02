import { Folder } from "lucide-react";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import path from "node:path";
import { and, asc, count, desc, eq, gt, lt, ne } from "drizzle-orm";
import { ItemRow, SourceIcon } from "@/components/hub-ui";
import { Button } from "@/components/ui/button";
import { shortPath } from "@/lib/format";
import { getDb } from "@/server/db";
import { folders, items, projects, shortcuts, sources } from "@/server/db/schema";
import { isLocalRequest } from "@/server/http/local";
import { linkFolderToProject, pinFolder } from "./actions";
import { FinderButton } from "./finder-button";
import { PolicyToggle } from "@/components/policy-toggle";
import { isDirectlyDenied } from "@/server/chat/policy";
import { externalDeny } from "@/server/db/schema";
import type { Db } from "@/server/db";

/** 상위(소스·상위 폴더)에서 이미 금지된 이유 */
function folderInherited(db: Db, f: { id: number; path: string }, s: { name: string; config: Record<string, unknown> }) {
  const out: string[] = [];
  if (s.config.externalAi === "deny") out.push(`소스 "${s.name}"`);
  const denied = db.select({ id: folders.id, name: folders.name, path: folders.path }).from(externalDeny).innerJoin(folders, eq(folders.id, externalDeny.targetId)).where(eq(externalDeny.targetKind, "folder")).all();
  for (const d of denied) if (d.id !== f.id && f.path.startsWith(d.path + "/")) out.push(`폴더 "${d.name}"`);
  return out;
}
import { folderUrl } from "@/server/connectors/gdrive/client";

const PAGE = 200;
const SORTS = { date: "최근 수정", name: "이름", size: "크기" } as const;
type Sort = keyof typeof SORTS;

export default async function FolderPage({ params, searchParams }: PageProps<"/folders/[id]">) {
  await connection();
  const { id } = await params;
  const sp = await searchParams;
  const sort: Sort = typeof sp.sort === "string" && sp.sort in SORTS ? (sp.sort as Sort) : "date";
  const page = Math.max(1, Number(sp.page) || 1);
  const db = getDb();
  const row = db.select({ f: folders, s: sources }).from(folders).innerJoin(sources, eq(sources.id, folders.sourceId)).where(eq(folders.id, Number(id))).get();
  if (!row) notFound();
  const { f, s } = row;
  const subfolders = db
    .select()
    .from(folders)
    .where(and(gt(folders.path, f.path + "/"), lt(folders.path, f.path + "0"), eq(folders.state, "ok")))
    .all()
    .filter((x) => path.dirname(x.path) === f.path)
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const inFolder = and(eq(items.folderId, f.id), ne(items.state, "deleted"));
  const total = db.select({ n: count() }).from(items).where(inFolder).get()?.n ?? 0;
  const list = db
    .select()
    .from(items)
    .where(inFolder)
    .orderBy(sort === "name" ? asc(items.title) : sort === "size" ? desc(items.size) : desc(items.modifiedAt))
    .limit(PAGE)
    .offset((page - 1) * PAGE)
    .all();
  const href = (o: { sort?: Sort; page?: number }) => {
    const u = new URLSearchParams();
    const so = o.sort ?? sort;
    if (so !== "date") u.set("sort", so);
    if ((o.page ?? 1) > 1) u.set("page", String(o.page));
    return `/folders/${f.id}${u.size ? `?${u}` : ""}`;
  };
  const parent = db.select().from(folders).where(eq(folders.path, path.dirname(f.path))).get();
  const pinned = db.select().from(shortcuts).where(and(eq(shortcuts.kind, "folder"), eq(shortcuts.target, String(f.id)))).get();
  const projectRows = db.select().from(projects).all();
  const local = isLocalRequest(await headers());

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <SourceIcon kind={s.kind} className="size-5" />
          <h1 className="break-all text-xl font-semibold">{f.name}</h1>
        </div>
        <p className="break-all text-sm text-muted-foreground">{shortPath(f.path)}</p>
        {f.state === "deleted" && <p className="text-sm text-destructive">폴더 없음 (삭제되었거나 찾을 수 없음)</p>}
        {s.status === "offline" && <p className="text-sm text-destructive">소스가 오프라인입니다.</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {parent && parent.path.startsWith(s.rootPath) && (
          <Link href={`/folders/${parent.id}`} className="text-sm underline">
            ← {parent.name}
          </Link>
        )}
        {local && !["gdrive", "notion", "github", "figma"].includes(s.kind) && <FinderButton id={f.id} />}
        {s.kind === "figma" && f.externalId?.startsWith("p") && (
          <a href={`https://www.figma.com/files/project/${f.externalId.slice(1)}`} target="_blank" rel="noreferrer" className="text-sm underline">
            Figma에서 열기
          </a>
        )}
        {s.kind === "notion" && f.externalId && (
          <a href={`https://www.notion.so/${f.externalId}`} target="_blank" rel="noreferrer" className="text-sm underline">
            Notion에서 열기
          </a>
        )}
        {s.kind === "gdrive" && f.externalId && (
          <a href={folderUrl(f.externalId)} target="_blank" rel="noreferrer" className="text-sm underline">
            Google Drive에서 열기
          </a>
        )}
        <PolicyToggle kind="folder" id={f.id} denied={isDirectlyDenied(db, "folder", f.id)} inherited={folderInherited(db, f, s)} />
        {!pinned && (
          <form action={pinFolder.bind(null, f.id)}>
            <Button type="submit" variant="outline" size="sm">
              홈 즐겨찾기에 추가
            </Button>
          </form>
        )}
        {projectRows.length > 0 && (
          <form action={linkFolderToProject.bind(null, f.id)} className="flex items-center gap-1">
            <select name="project" defaultValue="" className="h-7 rounded-md border bg-background px-1 text-xs">
              <option value="" disabled>
                프로젝트에 연결…
              </option>
              {projectRows.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline" size="sm" className="h-7 text-xs">
              연결
            </Button>
          </form>
        )}
      </div>
      {subfolders.length > 0 && (
        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {subfolders.map((d) => (
            <Link key={d.id} href={`/folders/${d.id}`} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted">
              <Folder className="size-4 text-muted-foreground" />
              <span className="truncate">{d.name}</span>
            </Link>
          ))}
        </div>
      )}
      {total > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>파일 {total.toLocaleString()}개{total > PAGE && ` · ${(page - 1) * PAGE + 1}–${Math.min(page * PAGE, total)}`}</span>
          <span className="ml-auto">정렬</span>
          {(Object.keys(SORTS) as Sort[]).map((k) => (
            <Link key={k} href={href({ sort: k })} className={`rounded-full border px-2 py-0.5 ${k === sort ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
              {SORTS[k]}
            </Link>
          ))}
        </div>
      )}
      <div className="divide-y">
        {list.map((i) => (
          <ItemRow key={i.id} item={{ ...i, sourceKind: s.kind, sourceStatus: s.status }} />
        ))}
        {!list.length && <p className="py-2 text-sm text-muted-foreground">이 폴더에 바로 들어 있는 파일이 없습니다.</p>}
      </div>
      {total > PAGE && (
        <div className="flex gap-3 text-sm">
          {page > 1 && (
            <Link href={href({ page: page - 1 })} className="underline">
              ← 이전
            </Link>
          )}
          {page * PAGE < total && (
            <Link href={href({ page: page + 1 })} className="underline">
              다음 →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
