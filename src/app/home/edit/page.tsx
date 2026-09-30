import { ArrowDown, ArrowUp, Folder, Trash2 } from "lucide-react";
import Link from "next/link";
import { headers } from "next/headers";
import { connection } from "next/server";
import { SiteIcon } from "@/components/home/bookmark-bar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getDb } from "@/server/db";
import { projects } from "@/server/db/schema";
import { bookmarkBar, readChromeBar, tiles } from "@/server/home";
import { isLocalRequest } from "@/server/http/local";
import { getSettings } from "@/server/settings";
import { ConfirmSubmit } from "@/app/settings/confirm-submit";
import {
  addBookmarkAction,
  addGroupAction,
  addTileAction,
  deleteBookmarkAction,
  deleteGroupAction,
  deleteTileAction,
  importBookmarkFileAction,
  importChromeAction,
  moveAction,
  renameGroupAction,
  resetBackground,
  uploadBackground,
} from "./actions";
import { TileFolderPicker } from "./tile-folder-picker";

function MoveButtons({ kind, id }: { kind: "bookmark" | "group" | "tile"; id: number }) {
  return (
    <span className="flex">
      <form action={moveAction.bind(null, kind, id, -1)}>
        <Button type="submit" variant="ghost" size="icon" className="size-7" aria-label="앞으로">
          <ArrowUp className="size-3.5" />
        </Button>
      </form>
      <form action={moveAction.bind(null, kind, id, 1)}>
        <Button type="submit" variant="ghost" size="icon" className="size-7" aria-label="뒤로">
          <ArrowDown className="size-3.5" />
        </Button>
      </form>
    </span>
  );
}

function BookmarkRow({ b }: { b: { id: number; title: string; url: string } }) {
  return (
    <li className="flex items-center gap-2 py-1 text-sm">
      <SiteIcon url={b.url} title={b.title} />
      <span className="truncate">{b.title}</span>
      <span className="hidden truncate text-xs text-muted-foreground sm:inline">{b.url}</span>
      <span className="ml-auto flex shrink-0 items-center">
        <MoveButtons kind="bookmark" id={b.id} />
        <form action={deleteBookmarkAction.bind(null, b.id)}>
          <Button type="submit" variant="ghost" size="icon" className="size-7" aria-label="삭제">
            <Trash2 className="size-3.5" />
          </Button>
        </form>
      </span>
    </li>
  );
}

export default async function HomeEditPage({ searchParams }: PageProps<"/home/edit">) {
  await connection();
  const msg = (await searchParams).msg;
  const db = getDb();
  const bar = bookmarkBar(db);
  const tileList = tiles(db);
  const projectRows = db.select().from(projects).all();
  const local = isLocalRequest(await headers());
  const chrome = local ? readChromeBar() : null;
  const bg = getSettings(db).homeBackground;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold">홈 꾸미기</h1>
        <Link href="/" className="ml-auto text-sm underline">
          홈으로 →
        </Link>
      </div>
      {typeof msg === "string" && <p className="rounded-md bg-muted px-3 py-2 text-sm">{msg}</p>}

      <Card id="tiles">
        <CardHeader>
          <CardTitle>즐겨찾기 타일</CardTitle>
          <CardDescription>홈 가운데 검색창 아래에 보입니다. 자주 여는 폴더, 프로젝트, 웹 주소를 넣으세요.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="divide-y">
            {tileList.map((t) => (
              <li key={t.id} className="flex items-center gap-2 py-1.5 text-sm">
                <span className="w-14 shrink-0 text-xs text-muted-foreground">{t.kind === "folder" ? "폴더" : t.kind === "project" ? "프로젝트" : "웹"}</span>
                <span className="truncate font-medium">{t.title}</span>
                <span className="hidden truncate text-xs text-muted-foreground sm:inline">{t.subtitle}</span>
                {t.warning && <span className="text-xs text-destructive">{t.warning}</span>}
                <span className="ml-auto flex shrink-0 items-center">
                  <MoveButtons kind="tile" id={t.id} />
                  <form action={deleteTileAction.bind(null, t.id)}>
                    <Button type="submit" variant="ghost" size="icon" className="size-7" aria-label="삭제">
                      <Trash2 className="size-3.5" />
                    </Button>
                  </form>
                </span>
              </li>
            ))}
            {!tileList.length && <li className="py-1.5 text-sm text-muted-foreground">아직 없습니다.</li>}
          </ul>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <p className="text-sm font-medium">폴더 추가</p>
              <TileFolderPicker />
            </div>
            <form action={addTileAction} className="space-y-2">
              <p className="text-sm font-medium">프로젝트 추가</p>
              <input type="hidden" name="kind" value="project" />
              <select name="target" className="h-8 w-full rounded-md border bg-background px-2 text-sm" required defaultValue="">
                <option value="" disabled>
                  프로젝트 선택
                </option>
                {projectRows.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <Button type="submit" size="sm" variant="outline" disabled={!projectRows.length}>
                추가
              </Button>
            </form>
            <form action={addTileAction} className="space-y-2">
              <p className="text-sm font-medium">웹 주소 추가</p>
              <input type="hidden" name="kind" value="url" />
              <Input name="title" placeholder="이름 (선택)" className="h-8" />
              <Input name="target" placeholder="https://…" className="h-8" required />
              <Button type="submit" size="sm" variant="outline">
                추가
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>

      <Card id="bookmarks">
        <CardHeader>
          <CardTitle>북마크 바</CardTitle>
          <CardDescription>홈 맨 위에 보입니다. 폴더를 누르면 안의 북마크가 펼쳐집니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {local && chrome && (
            <form action={importChromeAction} className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 p-2 text-sm">
              <span>
                Chrome 북마크 바: 폴더 {chrome.groups.length}개({chrome.groups.map((g) => g.name).join(", ")}), 북마크{" "}
                {chrome.root.length + chrome.groups.reduce((n, g) => n + g.items.length, 0)}개
              </span>
              <Button type="submit" size="sm" variant="outline">
                가져오기 (중복 제외)
              </Button>
            </form>
          )}

          <form action={importBookmarkFileAction} className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 p-2 text-sm">
            <span>
              다른 기기의 Chrome 북마크: Chrome 메뉴 → 북마크 → 북마크 관리자 → ⋮ → <b>북마크 내보내기</b>로 만든 HTML 파일
            </span>
            <input type="file" name="file" accept=".html,.htm,text/html" required className="text-sm" />
            <Button type="submit" size="sm" variant="outline">
              가져오기 (중복 제외)
            </Button>
          </form>

          {bar.groups.map((g) => (
            <div key={g.id} className="rounded-md border p-2">
              <div className="flex flex-wrap items-center gap-2">
                <Folder className="size-4 text-muted-foreground" />
                <form action={renameGroupAction.bind(null, g.id)} className="flex items-center gap-1">
                  <Input name="name" defaultValue={g.name} className="h-7 w-40" />
                  <Button type="submit" variant="ghost" size="sm" className="h-7 text-xs">
                    이름 저장
                  </Button>
                </form>
                <span className="ml-auto flex items-center">
                  <MoveButtons kind="group" id={g.id} />
                  <form action={deleteGroupAction.bind(null, g.id)}>
                    <ConfirmSubmit message={`'${g.name}' 폴더와 안의 북마크 ${g.items.length}개를 지울까요?`}>폴더 삭제</ConfirmSubmit>
                  </form>
                </span>
              </div>
              <ul className="divide-y pl-6">
                {g.items.map((b) => (
                  <BookmarkRow key={b.id} b={b} />
                ))}
              </ul>
            </div>
          ))}
          {bar.root.length > 0 && (
            <div className="rounded-md border p-2">
              <p className="text-xs text-muted-foreground">폴더 밖 (바에 바로 표시)</p>
              <ul className="divide-y">
                {bar.root.map((b) => (
                  <BookmarkRow key={b.id} b={b} />
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <form action={addBookmarkAction} className="space-y-2">
              <p className="text-sm font-medium">북마크 추가</p>
              <select name="group" className="h-8 w-full rounded-md border bg-background px-2 text-sm" defaultValue="">
                <option value="">폴더 밖 (바에 바로 표시)</option>
                {bar.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <Input name="title" placeholder="이름 (선택)" className="h-8" />
              <Input name="url" placeholder="https://…" className="h-8" required />
              <Button type="submit" size="sm" variant="outline">
                추가
              </Button>
            </form>
            <form action={addGroupAction} className="space-y-2">
              <p className="text-sm font-medium">북마크 폴더 추가</p>
              <Input name="name" placeholder="예: KMOU, AI, CODE" className="h-8" required />
              <Button type="submit" size="sm" variant="outline">
                추가
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>

      <Card id="background">
        <CardHeader>
          <CardTitle>배경</CardTitle>
          <CardDescription>홈 배경 이미지 (jpg, png, webp, gif · 15MB 이하). 이미지는 Mac mini 의 앱 데이터 폴더에 저장됩니다.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <form action={uploadBackground} className="flex flex-wrap items-center gap-2">
            <input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif" className="text-sm" required />
            <Button type="submit" size="sm">
              배경으로 설정
            </Button>
          </form>
          {bg && (
            <form action={resetBackground}>
              <Button type="submit" size="sm" variant="ghost">
                기본 배경으로
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
