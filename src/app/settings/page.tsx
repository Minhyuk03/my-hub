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
import { NotionRootForm } from "./notion-form";
import { notionWhoAmI } from "./notion-actions";
import { addGitHubAccount, githubWhoAmI } from "./github-actions";
import { figmaWhoAmI, setFigmaFetchText } from "./figma-actions";
import { FigmaTargetForm } from "./figma-form";
import { disconnectDrive, setDriveTestingMode } from "./drive-actions";
import { driveEnv, driveExpiry } from "@/server/connectors/gdrive/client";
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
  const dexp = driveExpiry(s.gdriveAccount, s.gdriveTestingMode);
  const notionToken = !!process.env.NOTION_TOKEN;
  const notionWho = notionToken ? await notionWhoAmI() : "";
  const notionSources = srcs.filter((x) => x.kind === "notion");
  const githubToken = !!process.env.GITHUB_TOKEN;
  const ghWho = githubToken ? await githubWhoAmI() : null;
  const githubSources = srcs.filter((x) => x.kind === "github");
  const figmaToken = !!process.env.FIGMA_TOKEN;
  const fgWho = figmaToken ? await figmaWhoAmI() : null;
  const figmaSources = srcs.filter((x) => x.kind === "figma");
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
                  <a href="/api/gdrive/connect" className="text-sm underline">
                    다시 연결
                  </a>
                )}
                {local && (
                  <form action={disconnectDrive}>
                    <ConfirmSubmit message="Google Drive 연결을 해제할까요? 이미 가져온 색인은 남고, 새 변경은 반영되지 않습니다.">연결 해제</ConfirmSubmit>
                  </form>
                )}
              </div>
              {dexp && (
                <p className={dexp.soon ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}>
                  테스트 중인 Google 앱: {dexp.expired ? "연결이 만료되었습니다. 다시 연결하세요." : `${new Date(dexp.expiresAt).toLocaleDateString("ko-KR")}에 만료 (${dexp.leftDays}일 남음)`}
                </p>
              )}
              <form action={setDriveTestingMode.bind(null, !s.gdriveTestingMode)} className="text-xs text-muted-foreground">
                {s.gdriveTestingMode ? "Google Cloud 에서 앱을 프로덕션으로 게시했다면 " : "앱이 다시 테스트 상태라면 "}
                <button type="submit" className="underline">
                  {s.gdriveTestingMode ? "만료 알림 끄기" : "만료 알림 켜기"}
                </button>
              </form>
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

      <Card id="notion">
        <CardHeader>
          <CardTitle>Notion</CardTitle>
          <CardDescription>내부 통합(읽기 전용)으로 연결합니다. 고른 페이지와 그 아래 하위 페이지·데이터베이스를 가져오고, 원본은 Notion 에서 열립니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!notionToken ? (
            <p className="text-destructive">.env.local 에 NOTION_TOKEN 이 필요합니다. (넣은 뒤 허브를 다시 시작)</p>
          ) : (
            <>
              <p>{notionWho}</p>
              {notionSources.map((n) => (
                <p key={n.id} className="text-muted-foreground">
                  가져오는 중인 페이지: <b className="text-foreground">{n.name}</b> · 항목 {n.total.toLocaleString()}개
                </p>
              ))}
              <NotionRootForm defaultPage={notionSources.length ? "" : "https://app.notion.com/p/4-3e3533f6b13580518794cd78560ee63c"} />
              <p className="text-xs text-muted-foreground">가져올 페이지는 Notion 에서 ⋯ → 연결(Connections) → 이 통합을 추가해야 보입니다. 하위 페이지는 자동으로 함께 공유됩니다.</p>
            </>
          )}
        </CardContent>
      </Card>

      <Card id="github">
        <CardHeader>
          <CardTitle>GitHub</CardTitle>
          <CardDescription>읽기 전용 토큰으로 내가 소유한 저장소의 README·최근 커밋·이슈·PR 을 가져옵니다. 원본은 GitHub 에서 열립니다.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!githubToken ? (
            <p className="text-destructive">.env.local 에 GITHUB_TOKEN 이 필요합니다. (넣은 뒤 허브를 다시 시작)</p>
          ) : (
            <>
              <p className={ghWho?.ok ? "" : "text-destructive"}>{ghWho?.ok ? `토큰 계정: ${ghWho.message}` : ghWho?.message}</p>
              {githubSources.map((g) => (
                <p key={g.id} className="text-muted-foreground">
                  가져오는 중: <b className="text-foreground">{g.name}</b> · 항목 {g.total.toLocaleString()}개
                </p>
              ))}
              {ghWho?.ok && !githubSources.length && (
                <div className="flex flex-wrap gap-2">
                  <form action={addGitHubAccount.bind(null, false)}>
                    <Button type="submit" size="sm">
                      내 저장소 가져오기
                    </Button>
                  </form>
                  <form action={addGitHubAccount.bind(null, true)}>
                    <Button type="submit" size="sm" variant="outline">
                      포크한 저장소도 포함
                    </Button>
                  </form>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Card id="figma">
        <CardHeader>
          <CardTitle>Figma</CardTitle>
          <CardDescription>
            Figma 는 &ldquo;내 파일 전체 목록&rdquo;을 주지 않아 팀·프로젝트 주소를 등록합니다. 기본은 파일 이름·수정 시각·미리보기 이미지만 가져오고, 원본은 Figma 에서 열립니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!figmaToken ? (
            <p className="text-destructive">.env.local 에 FIGMA_TOKEN 이 필요합니다. (넣은 뒤 허브를 다시 시작)</p>
          ) : (
            <>
              <p className={fgWho?.ok ? "" : "text-destructive"}>{fgWho?.ok ? `토큰 계정: ${fgWho.message}` : fgWho?.message}</p>
              {figmaSources.map((f) => {
                const on = !!(f.config as { fetchText?: boolean }).fetchText;
                return (
                  <div key={f.id} className="flex flex-wrap items-center gap-2 text-muted-foreground">
                    <b className="text-foreground">{f.name}</b> · 항목 {f.total.toLocaleString()}개 · 내용 텍스트 {on ? "켜짐" : "꺼짐"}
                    <form action={setFigmaFetchText.bind(null, f.id, !on)}>
                      <Button type="submit" size="sm" variant="ghost" className="h-6 text-xs">
                        {on ? "끄기" : "켜기"}
                      </Button>
                    </form>
                  </div>
                );
              })}
              <FigmaTargetForm />
            </>
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
