import { connection } from "next/server";
import { SourceIcon, SourceStatusBadge } from "@/components/hub-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { shortPath } from "@/lib/format";
import { SOURCE_KIND_LABEL } from "@/lib/labels";
import { getDb } from "@/server/db";
import { sourcesWithStats } from "@/server/queries";
import { getSettings } from "@/server/settings";
import { removeSourceAction, saveSettings, shortcuts } from "./actions";
import { ConfirmSubmit } from "./confirm-submit";
import { FolderPicker } from "./folder-picker";

function NumField({ name, label, value, unit }: { name: string; label: string; value: number; unit: string }) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span>{label}</span>
      <span className="flex items-center gap-1">
        <Input type="number" name={name} defaultValue={value} className="h-8 w-24" />
        <span className="w-8 text-muted-foreground">{unit}</span>
      </span>
    </label>
  );
}

export default async function SettingsPage() {
  await connection();
  const db = getDb();
  const s = getSettings(db);
  const srcs = sourcesWithStats(db);
  const sc = await shortcuts();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">설정</h1>

      <Card>
        <CardHeader>
          <CardTitle>인덱싱 폴더</CardTitle>
          <CardDescription>등록을 해제해도 실제 파일은 지워지지 않습니다. 허브의 색인에서만 빠집니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {!srcs.length && <p className="text-sm text-muted-foreground">등록된 폴더가 없습니다.</p>}
          {srcs.map((src) => (
            <div key={src.id} className="flex flex-wrap items-center gap-2 border-b py-2 text-sm last:border-0">
              <SourceIcon kind={src.kind} />
              <span className="font-medium">{src.name}</span>
              <span className="text-xs text-muted-foreground">{SOURCE_KIND_LABEL[src.kind]}</span>
              <SourceStatusBadge status={src.status} />
              <span className="w-full truncate pl-6 text-xs text-muted-foreground sm:w-auto sm:pl-0">{shortPath(src.rootPath)}</span>
              <form action={removeSourceAction.bind(null, src.id)} className="ml-auto">
                <ConfirmSubmit message={`'${src.name}' 을(를) 인덱싱에서 뺄까요? 실제 파일은 그대로 남습니다.`}>등록 해제</ConfirmSubmit>
              </form>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>폴더 추가</CardTitle>
          <CardDescription>
            폴더를 골라 추가하면 바로 인덱싱을 시작합니다. 외장 디스크에서는 새 폴더를 만들 수 있습니다 (경로 확인 후 생성). iCloud에만 있는 파일은
            제목·정보만 저장하고 내려받지 않습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FolderPicker shortcuts={sc} />
        </CardContent>
      </Card>

      <form action={saveSettings}>
        <Card>
          <CardHeader>
            <CardTitle>제외 규칙과 동작</CardTitle>
            <CardDescription>숨김 파일·폴더(이름이 .으로 시작)는 항상 제외합니다. 백업 폴더도 자동으로 제외합니다.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 md:grid-cols-2">
            <div className="space-y-4">
              <label className="block space-y-1 text-sm">
                <span className="font-medium">제외 폴더 (한 줄에 하나)</span>
                <textarea name="excludedFolders" defaultValue={s.excludedFolders.join("\n")} rows={4} className="w-full rounded-md border bg-background p-2 font-mono text-xs" />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="font-medium">제외 이름 패턴 (한 줄에 하나, * 사용 가능)</span>
                <textarea name="excludedPatterns" defaultValue={s.excludedPatterns.join("\n")} rows={6} className="w-full rounded-md border bg-background p-2 font-mono text-xs" />
              </label>
              <label className="block space-y-1 text-sm">
                <span className="font-medium">편집기로 열기 (확장자 = 앱 이름)</span>
                <textarea
                  name="editorByExt"
                  defaultValue={Object.entries(s.editorByExt)
                    .map(([k, v]) => `${k} = ${v}`)
                    .join("\n")}
                  rows={4}
                  className="w-full rounded-md border bg-background p-2 font-mono text-xs"
                />
              </label>
            </div>
            <div className="space-y-3">
              <NumField name="fullScanIntervalHours" label="전체 재검사 주기" value={s.fullScanIntervalHours} unit="시간" />
              <NumField name="maxExtractMB" label="본문 추출 파일 크기 상한" value={s.maxExtractMB} unit="MB" />
              <NumField name="concurrency" label="동시 처리 수" value={s.concurrency} unit="개" />
              <NumField name="deletedRetentionDays" label="삭제된 항목 보관 기간" value={s.deletedRetentionDays} unit="일" />
              <NumField name="backupHour" label="자동 백업 시각" value={s.backupHour} unit="시" />
              <NumField name="backupKeepDaily" label="일간 백업 보관" value={s.backupKeepDaily} unit="개" />
              <NumField name="backupKeepWeekly" label="주간 백업 보관" value={s.backupKeepWeekly} unit="개" />
              <p className="text-xs text-muted-foreground">
                백업 위치: <code>{s.backupDir}</code>
              </p>
              <Button type="submit">저장</Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  );
}
