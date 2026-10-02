import Link from "next/link";
import { connection } from "next/server";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/server/db";
import type { ProjectKind } from "@/server/db/schema";
import { PARA_DIRS, previewParaImport } from "@/server/projects/para";
import { importParaAction } from "../actions";

const KIND_INFO: Record<ProjectKind, { dir: string; label: string }> = {
  project: { dir: "1. Projects", label: "프로젝트" },
  area: { dir: "2. Areas", label: "영역" },
  resource: { dir: "3. Resources", label: "자료" },
};

export default async function ImportPage({ searchParams }: PageProps<"/projects/import">) {
  await connection();
  const sp = await searchParams;
  const kind = (typeof sp.kind === "string" && sp.kind in KIND_INFO ? sp.kind : "project") as ProjectKind;
  const info = KIND_INFO[kind];
  const rows = previewParaImport(getDb(), PARA_DIRS[kind]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Obsidian {info.dir} 가져오기</CardTitle>
        <div className="flex gap-1 pt-1">
          {(Object.keys(KIND_INFO) as ProjectKind[]).map((k) => (
            <Link key={k} href={`/projects/import?kind=${k}`} className={buttonVariants({ size: "sm", variant: k === kind ? "secondary" : "ghost" })}>
              {KIND_INFO[k].dir}
            </Link>
          ))}
        </div>
        <CardDescription>
          <code>{PARA_DIRS[kind].replace(/^\/Users\/[^/]+/, "~")}</code> 바로 아래 폴더를 {info.label}(으)로 만들고 폴더를 연결합니다. 체크한 것만 가져오고, 파일은 옮기지 않습니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!rows.length ? (
          <p className="text-sm text-muted-foreground">
            가져올 폴더가 없습니다. Obsidian 볼트가 인덱싱되어 있는지 <Link href="/status" className="underline">동기화 상태</Link>를 확인하세요.
          </p>
        ) : (
          <form action={importParaAction} className="space-y-2">
            <input type="hidden" name="kind" value={kind} />
            {rows.map((r) => (
              <label key={r.folderId} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="folder" value={r.folderId} defaultChecked={!r.existingProjectId} />
                <span className="font-medium">{r.name}</span>
                {r.existingProjectId && <span className="text-xs text-muted-foreground">(같은 이름이 이미 있어 폴더만 연결)</span>}
              </label>
            ))}
            <Button type="submit">선택한 폴더 가져오기</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
