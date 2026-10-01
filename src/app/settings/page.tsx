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
import { removeSourceAction, saveHomeTitle, saveSettings, shortcuts } from "./actions";
import { ConfirmSubmit } from "./confirm-submit";
import { FolderPicker } from "./folder-picker";
import { PasscodeForm } from "./passcode-form";
import { DrivePicker } from "./drive-picker";
import { disconnectDrive } from "./drive-actions";
import { driveEnv } from "@/server/connectors/gdrive/client";
import { saveAllowlist } from "./security-actions";
import { headers } from "next/headers";
import { isLocalRequest } from "@/server/http/local";
import { tailscaleSelf, tailscaleServeStatus } from "@/server/http/tailscale";

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

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  await connection();
  const db = getDb();
  const s = getSettings(db);
  const srcs = sourcesWithStats(db);
  const sc = await shortcuts();
  const driveMsg = (await searchParams).gdrive;
  const denv = driveEnv();
  const local = isLocalRequest(await headers());
  const ts = local ? tailscaleSelf() : null;
  const serve = local ? tailscaleServeStatus() : "";

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
                <ConfirmSubmit message={`'${src.name}' 을(를) 인덱싱에서 뺄까요? 실제 파일은 그대로 남습니다. 이 폴더들에 걸린 프로젝트 연결도 함께 해제됩니다.`}>등록 해제</ConfirmSubmit>
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

      {local && (
        <Card>
          <CardHeader>
            <CardTitle>외부 접속 (Tailscale)</CardTitle>
            <CardDescription>
              아이폰·노트북은 Tailscale 로만 접속합니다. 허용 목록의 계정 + 앱 패스코드가 모두 맞아야 들어올 수 있습니다. 이 항목은 Mac mini 에서만 바꿀 수 있습니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p>
              이 Mac: {ts ? `${ts.login || "(로그인 정보 없음)"} · https://${ts.dnsName} ${ts.online ? "" : "(오프라인)"}` : "Tailscale 정보를 읽지 못했습니다."}
            </p>
            <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">{serve || "serve 설정 없음"}</pre>
            <form action={saveAllowlist} className="space-y-2">
              <label className="block space-y-1">
                <span className="font-medium">허용할 Tailscale 로그인 계정 (한 줄에 하나)</span>
                <textarea
                  name="logins"
                  rows={2}
                  defaultValue={(s.allowedTailscaleLogins.length ? s.allowedTailscaleLogins : ts?.login ? [ts.login] : []).join("\n")}
                  className="w-full rounded-md border bg-background p-2 font-mono text-xs"
                />
              </label>
              <Button type="submit" size="sm" variant="outline">
                허용 목록 저장
              </Button>
              {!s.allowedTailscaleLogins.length && <span className="ml-2 text-destructive">아직 저장되지 않았습니다.</span>}
            </form>
            <PasscodeForm isSet={!!s.passcodeHash} />
          </CardContent>
        </Card>
      )}

      <Card id="gdrive">
        <CardHeader>
          <CardTitle>Google Drive</CardTitle>
          <CardDescription>읽기 전용으로 연결합니다. 고른 폴더만 가져오고, Drive 문서는 원본 Google 화면으로 열립니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {typeof driveMsg === "string" && <p className="rounded-md bg-muted px-3 py-2">{driveMsg}</p>}
          {!denv.configured ? (
            <p className="text-destructive">.env.local 에 GOOGLE_CLIENT_ID 와 GOOGLE_CLIENT_SECRET 이 필요합니다.</p>
          ) : s.gdriveAccount ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span>
                  연결된 계정: <b>{s.gdriveAccount.email}</b>
                </span>
                {local && (
                  <form action={disconnectDrive}>
                    <ConfirmSubmit message="Google Drive 연결을 해제할까요? 이미 가져온 색인은 남고, 새 변경은 반영되지 않습니다.">연결 해제</ConfirmSubmit>
                  </form>
                )}
              </div>
              <DrivePicker />
            </>
          ) : local ? (
            <a href="/api/gdrive/connect" className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">
              Google Drive 연결
            </a>
          ) : (
            <p className="text-muted-foreground">연결은 Mac mini에서 직접 접속해 진행하세요.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>홈 화면</CardTitle>
          <CardDescription>홈 가운데 큰 제목 (40자까지). 북마크·즐겨찾기·배경은 홈의 &ldquo;꾸미기&rdquo;에서 바꿉니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={saveHomeTitle} className="flex flex-wrap items-center gap-2">
            <Input name="homeTitle" defaultValue={s.homeTitle} maxLength={40} placeholder="나의 허브" className="h-9 max-w-sm" />
            <Button type="submit" size="sm">
              저장
            </Button>
          </form>
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
                <span className="font-medium">폴더 이름 동의어 (프로젝트 연결 제안용, 예: 리뉴얼 = renewal)</span>
                <textarea name="synonyms" defaultValue={s.synonyms.join("\n")} rows={4} className="w-full rounded-md border bg-background p-2 font-mono text-xs" />
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
