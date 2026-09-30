import Link from "next/link";
import { connection } from "next/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/server/db";
import { PARA_PROJECTS_DIR, previewParaImport } from "@/server/projects/para";
import { importParaAction } from "../actions";

export default async function ImportPage() {
  await connection();
  const rows = previewParaImport(getDb());
  return (
    <Card>
      <CardHeader>
        <CardTitle>Obsidian 1. Projects 가져오기</CardTitle>
        <CardDescription>
          <code>{PARA_PROJECTS_DIR.replace(/^\/Users\/[^/]+/, "~")}</code> 바로 아래 폴더를 프로젝트로 만들고 폴더를 연결합니다. 체크한 것만 가져옵니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!rows.length ? (
          <p className="text-sm text-muted-foreground">
            가져올 폴더가 없습니다. Obsidian 볼트가 인덱싱되어 있는지 <Link href="/status" className="underline">동기화 상태</Link>를 확인하세요.
          </p>
        ) : (
          <form action={importParaAction} className="space-y-2">
            {rows.map((r) => (
              <label key={r.folderId} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="folder" value={r.folderId} defaultChecked={!r.existingProjectId} />
                <span className="font-medium">{r.name}</span>
                {r.existingProjectId && <span className="text-xs text-muted-foreground">(같은 이름의 프로젝트가 있어 폴더만 연결)</span>}
              </label>
            ))}
            <Button type="submit">선택한 폴더 가져오기</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
