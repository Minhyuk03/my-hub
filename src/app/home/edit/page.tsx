import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import Link from "next/link";
import { connection } from "next/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getDb } from "@/server/db";
import { projects } from "@/server/db/schema";
import { tiles } from "@/server/home";
import {
  addTileAction,
  deleteTileAction,
  moveAction,
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

export default async function HomeEditPage({ searchParams }: PageProps<"/home/edit">) {
  await connection();
  const msg = (await searchParams).msg;
  const db = getDb();
  const tileList = tiles(db);
  const projectRows = db.select().from(projects).all();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold">즐겨찾기 편집</h1>
        <Link href="/hub" className="ml-auto text-sm underline">
          허브로 →
        </Link>
      </div>
      {typeof msg === "string" && <p className="rounded-md bg-muted px-3 py-2 text-sm">{msg}</p>}

      <Card id="tiles">
        <CardHeader>
          <CardTitle>즐겨찾기 타일</CardTitle>
          <CardDescription>허브 왼쪽 &ldquo;즐겨찾기&rdquo;에 보입니다. 자주 여는 폴더와 프로젝트를 넣으세요.</CardDescription>
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

    </div>
  );
}
