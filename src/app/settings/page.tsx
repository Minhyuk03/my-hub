import { SettingsTabs } from "@/components/settings-tabs";
import { connection } from "next/server";
import { SourceIcon, SourceStatusBadge } from "@/components/hub-ui";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { shortPath } from "@/lib/format";
import { SOURCE_KIND_LABEL } from "@/lib/labels";
import { getDb } from "@/server/db";
import { sourcesWithStats } from "@/server/queries";
import { getSettings } from "@/server/settings";
import { removeSourceAction, saveSettings, shortcuts } from "./actions";
import { ConfirmSubmit } from "./confirm-submit";
import { PolicyToggle } from "@/components/policy-toggle";
import { denyList } from "@/server/chat/policy";
import { hasKey } from "@/server/chat/llm";
import { saveChatSettings } from "./chat-actions";
import { saveTagAliases } from "./tag-actions";
import { connectCalendar, disconnectCalendar, refreshCalendar, saveCalendarHidden } from "./calendar-actions";
import type { CalendarSnapshot } from "@/server/calendar";
import { runtime } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { FolderPicker } from "./folder-picker";
import { PasscodeForm } from "./passcode-form";
import { DrivePicker } from "./drive-picker";
import { NotionRootForm } from "./notion-form";
import { notionWhoAmI } from "./notion-actions";
import { githubWhoAmI } from "./github-actions";
import { GitHubImportForm } from "./github-form";
import { figmaWhoAmI, setFigmaFetchText } from "./figma-actions";
import { FigmaTargetForm } from "./figma-form";
import { disconnectDrive, setDriveTestingMode } from "./drive-actions";
import { driveEnv, driveExpiry } from "@/server/connectors/gdrive/client";
import { saveAllowlist, setRequireLocalPasscode } from "./security-actions";
import { headers } from "next/headers";
import os from "node:os";
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

/** 포트폴리오와 같은 섹션: 작은 영문 라벨 · 가는 제목 · 설명, 왼쪽 목차에서 이동 */
function Section({ id, label, title, desc, children }: { id: string; label: string; title: string; desc?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t py-10 first:border-t-0 first:pt-0">
      <header className="mb-5 max-w-3xl space-y-2">
        <p className="text-[11px] uppercase tracking-[0.3em] text-primary">{label}</p>
        <h2 className="text-2xl font-light">{title}</h2>
        {desc && <p className="text-xs leading-relaxed text-muted-foreground">{desc}</p>}
      </header>
      <div className="min-w-0 space-y-3 text-sm">{children}</div>
    </section>
  );
}

/** 연결 서비스 한 칸: 이름 · 상태 점 · 설명 */
function Connector({ id, name, on, state, desc, children }: { id: string; name: string; on: boolean | null; state: string; desc: React.ReactNode; children: React.ReactNode }) {
  return (
    <div id={id} className="scroll-mt-24 space-y-3 rounded-sm border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-normal tracking-wide">{name}</h3>
        <span className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={`size-1.5 rounded-full ${on === null ? "bg-muted-foreground/40" : on ? "bg-emerald-500" : "bg-amber-500"}`} />
          {state}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{desc}</p>
      {children}
    </div>
  );
}

const area = "w-full rounded-sm border bg-background p-2 font-mono text-xs";

/** 연결 방법 단계 안내. 연결이 안 되어 있거나 끊겼으면 펼쳐 둔다 */
function HowTo({ title, open, children }: { title: string; open: boolean; children: React.ReactNode }) {
  return (
    <details open={open} className="rounded-sm border border-dashed px-4 py-3 text-xs">
      <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">{title}</summary>
      <ol className="mt-3 list-decimal space-y-2 pl-4 leading-relaxed text-muted-foreground marker:text-primary [&_a]:text-foreground [&_a]:underline [&_b]:font-normal [&_b]:text-foreground [&_code]:rounded-sm [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:break-all [&_code]:text-foreground">
        {children}
      </ol>
    </details>
  );
}

/** 토큰을 .env.local 에 넣고 허브를 다시 시작하는 단계 (Notion·GitHub·Figma 공통) */
function TokenSteps({ name, prefix, check }: { name: string; prefix: string; check: string }) {
  const env = `${REPO}/.env.local`;
  return (
    <>
      <li>
        Mac mini 의 터미널에서 <code>open -e {env}</code> 를 실행해 설정 파일을 엽니다.
      </li>
      <li>
        <code>{name}=</code> 줄의 <code>=</code> 뒤에 복사한 토큰(<code>{prefix}…</code>)을 붙여 넣고 저장합니다. 따옴표·띄어쓰기 없이 한 줄로 넣습니다.
      </li>
      <li>
        터미널에서 <code>bash {REPO}/scripts/service/restart.sh</code> 로 허브를 다시 시작하고, 이 화면을 새로고침합니다. {check}
      </li>
    </>
  );
}

/** 허브 폴더 (~ 로 줄여 보여 줌) */
const REPO = process.cwd().replace(os.homedir(), "~");
const LOCAL_SETTINGS = "http://127.0.0.1:3000/settings";

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

  const calSnap = db.select().from(runtime).where(eq(runtime.key, "calendar")).get()?.value as CalendarSnapshot | undefined;
  const deny = denyList(db);
  const denyRows = [
    ...deny.sources.map((x) => ({ k: `s${x.id}`, label: `소스 · ${x.name}`, href: "/settings#sources" })),
    ...deny.projects.map((x) => ({ k: `p${x.id}`, label: `프로젝트 · ${x.name}`, href: `/projects/${x.id}` })),
    ...deny.folders.map((x) => ({ k: `f${x.id}`, label: `폴더 · ${x.name}`, href: `/folders/${x.id}` })),
    ...deny.items.map((x) => ({ k: `i${x.id}`, label: `항목 · ${x.name}`, href: `/items/${x.id}` })),
  ];
  const toc = [
    ["sources", "Sources", "인덱싱 폴더"],
    ["add", "Add Folder", "폴더 추가"],
    ...(local ? [["access", "Access", "외부 접속"]] : []),
    ["connect", "Connect", "연결 서비스"],
    ["tags", "Tags", "태그 합치기"],
    ["calendar", "Calendar", "일정"],
    ["chat", "AI Chat", "AI 채팅"],
    ["portfolio", "Portfolio", "첫 화면"],
    ["rules", "Rules", "제외 규칙과 동작"],
  ];
  const err = "text-destructive";

  return (
    <div className="space-y-8">
      <SettingsTabs current="/settings" />
      <div className="space-y-2">
        <h1 className="text-3xl font-light tracking-wide">설정</h1>
        <p className="text-sm text-muted-foreground">
          폴더 {srcs.length}곳 · 항목 {srcs.reduce((n, x) => n + x.total, 0).toLocaleString()}개를 색인하고 있습니다. 바꾼 내용은 칸마다 저장 버튼으로 저장합니다.
        </p>
      </div>

      <div className="grid gap-10 md:grid-cols-[11rem_minmax(0,1fr)]">
        <nav aria-label="설정 목차" className="hidden md:block">
          <ol className="sticky top-24 space-y-1 border-l text-sm">
            {toc.map(([id, en, ko], i) => (
              <li key={id}>
                <a href={`#${id}`} className="group -ml-px flex items-baseline gap-2 border-l border-transparent py-1 pl-4 text-muted-foreground hover:border-primary hover:text-foreground">
                  <span className="text-[10px] tabular-nums text-primary/70">{String(i + 1).padStart(2, "0")}</span>
                  <span>
                    <span className="block text-[11px] uppercase tracking-[0.2em]">{en}</span>
                    <span className="block text-xs text-muted-foreground/80">{ko}</span>
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="min-w-0">
          <Section id="sources" label="Sources" title="인덱싱 폴더" desc="등록을 해제해도 실제 파일은 지워지지 않습니다. 허브의 색인에서만 빠집니다. 🔒 는 외부 AI 로 보내지 않기.">
            {!srcs.length && <p className="text-muted-foreground">등록된 폴더가 없습니다.</p>}
            {!!srcs.length && (
              <ul className="divide-y rounded-sm border bg-card">
                {srcs.map((src) => (
                  <li key={src.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                    <SourceIcon kind={src.kind} />
                    <span className="min-w-0">
                      <span className="block font-normal">{src.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {SOURCE_KIND_LABEL[src.kind]} · {shortPath(src.rootPath)} · {src.total.toLocaleString()}개
                      </span>
                    </span>
                    <span className="ml-auto flex items-center gap-1">
                      <SourceStatusBadge status={src.status} />
                      <PolicyToggle kind="source" id={src.id} denied={(src.config as Record<string, unknown>).externalAi === "deny"} />
                      <form action={removeSourceAction.bind(null, src.id)}>
                        <ConfirmSubmit message={`'${src.name}' 을(를) 인덱싱에서 뺄까요? 실제 파일은 그대로 남습니다. 이 폴더들에 걸린 프로젝트 연결도 함께 해제됩니다.`}>등록 해제</ConfirmSubmit>
                      </form>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            id="add"
            label="Add Folder"
            title="폴더 추가"
            desc="폴더를 골라 추가하면 바로 인덱싱을 시작합니다. 외장 디스크에서는 새 폴더를 만들 수 있습니다 (경로 확인 후 생성). iCloud에만 있는 파일은 제목·정보만 저장하고 내려받지 않습니다."
          >
            <FolderPicker shortcuts={sc} />
          </Section>

          {local && (
            <Section
              id="access"
              label="Access"
              title="외부 접속 (Tailscale)"
              desc="아이폰·노트북은 Tailscale 로만 접속합니다. 허용 목록의 계정 + 앱 패스코드가 모두 맞아야 들어올 수 있습니다. 이 항목은 Mac mini 에서만 바꿀 수 있습니다."
            >
              <p>
                이 Mac: {ts ? `${ts.login || "(로그인 정보 없음)"} · https://${ts.dnsName} ${ts.online ? "" : "(오프라인)"}` : "Tailscale 정보를 읽지 못했습니다."}
              </p>
              <pre className="overflow-x-auto rounded-sm bg-muted p-3 text-xs">{serve || "serve 설정 없음"}</pre>
              <form action={saveAllowlist} className="space-y-2">
                <label className="block space-y-1">
                  <span className="text-muted-foreground">허용할 Tailscale 로그인 계정 (한 줄에 하나)</span>
                  <textarea name="logins" rows={2} defaultValue={(s.allowedTailscaleLogins.length ? s.allowedTailscaleLogins : ts?.login ? [ts.login] : []).join("\n")} className={area} />
                </label>
                <Button type="submit" size="sm" variant="outline">
                  허용 목록 저장
                </Button>
                {!s.allowedTailscaleLogins.length && <span className={`ml-2 ${err}`}>아직 저장되지 않았습니다.</span>}
              </form>
              <div className="border-t pt-4">
                <PasscodeForm isSet={!!s.passcodeHash} />
              </div>
              <form action={setRequireLocalPasscode.bind(null, !s.requireLocalPasscode)} className="space-y-1 border-t pt-4">
                <p>Mac mini 에서 접속할 때도 패스코드 요구: {s.requireLocalPasscode ? "켜짐" : "꺼짐"}</p>
                <p className="text-xs text-muted-foreground">
                  켜면 이 Mac 의 다른 프로그램이나 다른 사용자 계정이 허브(127.0.0.1)로 자료를 읽지 못합니다. 이 Mac 의 브라우저에서도 처음 한 번(90일마다) 패스코드를
                  넣습니다. 허브는 전체 디스크 접근 권한이 있어서, 켜 두는 것을 권합니다.
                </p>
                <Button type="submit" size="sm" variant="outline" disabled={!s.passcodeHash && !s.requireLocalPasscode}>
                  {s.requireLocalPasscode ? "끄기" : s.passcodeHash ? "켜기" : "먼저 패스코드를 정하세요"}
                </Button>
              </form>
            </Section>
          )}

          <Section id="connect" label="Connect" title="연결 서비스" desc="모두 읽기 전용입니다. 가져온 문서는 원본 서비스 화면으로 열립니다. 칸마다 연결하는 방법을 순서대로 적어 두었고, 끊긴 칸은 펼쳐져 있습니다.">
            {typeof driveMsg === "string" && <p className="rounded-sm bg-muted px-3 py-2">{driveMsg}</p>}
            <div className="grid gap-4 lg:grid-cols-2">
              <Connector
                id="gdrive"
                name="Google Drive"
                on={!denv.configured ? null : !!s.gdriveAccount && !dexp?.expired}
                state={!denv.configured ? "설정 필요" : !s.gdriveAccount ? "연결 안 됨" : dexp?.expired ? "만료됨" : "연결됨"}
                desc="고른 폴더만 가져오고, Drive 문서는 원본 Google 화면으로 열립니다."
              >
                {!denv.configured ? (
                  <p className={err}>.env.local 에 GOOGLE_CLIENT_ID 와 GOOGLE_CLIENT_SECRET 이 필요합니다.</p>
                ) : (
                  <>
                    {s.gdriveAccount && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span>
                          계정: <b className="font-normal">{s.gdriveAccount.email}</b>
                        </span>
                        {local && (
                          <form action={disconnectDrive}>
                            <ConfirmSubmit message="Google Drive 연결을 해제할까요? 이미 가져온 색인은 남고, 새 변경은 반영되지 않습니다.">연결 해제</ConfirmSubmit>
                          </form>
                        )}
                      </div>
                    )}
                    {dexp && (
                      <p className={dexp.soon ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}>
                        테스트 중인 Google 앱: {dexp.expired ? "연결이 만료되었습니다. 아래 순서대로 다시 연결하세요." : `${new Date(dexp.expiresAt).toLocaleDateString("ko-KR")}에 만료 (${dexp.leftDays}일 남음)`}
                      </p>
                    )}
                    {local ? (
                      <a
                        href="/api/gdrive/connect"
                        className={`inline-flex h-8 items-center rounded-sm px-3 text-sm ${!s.gdriveAccount || dexp?.expired ? "bg-primary text-primary-foreground hover:opacity-90" : "border hover:bg-muted"}`}
                      >
                        {s.gdriveAccount ? "Google Drive 다시 연결" : "Google Drive 연결"}
                      </a>
                    ) : (
                      <p className="rounded-sm bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-300">
                        지금은 Tailscale 주소로 접속 중이라 여기서는 연결 버튼이 나오지 않습니다. Mac mini 에서 <b className="font-normal">{LOCAL_SETTINGS}#gdrive</b> 를 여세요.
                      </p>
                    )}
                    <HowTo title={s.gdriveAccount ? "다시 연결하는 방법" : "연결하는 방법"} open={!s.gdriveAccount || !!dexp?.expired}>
                      <li>
                        {local ? (
                          "지금 Mac mini 에서 직접 접속 중이라 이 화면에서 바로 연결할 수 있습니다."
                        ) : (
                          <>
                            <b>Mac mini 앞에서</b> 브라우저로 <code>{LOCAL_SETTINGS}#gdrive</code> 를 엽니다. 휴대폰·노트북이나 Mac mini 에서도 Tailscale 주소(…ts.net)로는 연결할 수 없습니다. Google 이 연결을
                            마친 뒤 이 Mac 의 127.0.0.1 주소로 돌려보내기 때문입니다.
                          </>
                        )}
                      </li>
                      <li>
                        <b>{s.gdriveAccount ? "Google Drive 다시 연결" : "Google Drive 연결"}</b> 버튼을 누릅니다.
                      </li>
                      <li>Google 로그인 화면에서 {s.gdriveAccount ? <b>{s.gdriveAccount.email}</b> : "연결할"} 계정을 고릅니다.</li>
                      <li>
                        &ldquo;Google에서 확인하지 않은 앱&rdquo; 경고가 나오면 <b>고급</b> → <b>…(으)로 이동(안전하지 않음)</b>을 누릅니다. 직접 만든 테스트용 앱이라 나오는 경고입니다.
                      </li>
                      <li>
                        &ldquo;Google Drive 파일 보기&rdquo; 권한 화면에서 <b>계속</b>을 누릅니다 (읽기 전용).
                      </li>
                      <li>
                        허브 설정 화면으로 돌아와 이 칸 위에 결과 메시지가 뜨면 끝입니다. 끊겼던 Drive 폴더는 몇 분 안에 다시 동기화됩니다 (
                        <Link href="/status">동기화 상태</Link>에서 확인).
                      </li>
                      {s.gdriveTestingMode && (
                        <li>
                          Google 앱이 &ldquo;테스트&rdquo; 상태라 연결이 7일마다 만료됩니다. Google Cloud Console → <b>OAuth 동의 화면</b>(Google Auth Platform → 대상) 에서 <b>앱 게시</b>로 프로덕션으로 바꾸면
                          만료되지 않습니다.
                        </li>
                      )}
                    </HowTo>
                    {s.gdriveAccount && (
                      <>
                        <form action={setDriveTestingMode.bind(null, !s.gdriveTestingMode)} className="text-xs text-muted-foreground">
                          {s.gdriveTestingMode ? "Google Cloud 에서 앱을 프로덕션으로 게시했다면 " : "앱이 다시 테스트 상태라면 "}
                          <button type="submit" className="underline">
                            {s.gdriveTestingMode ? "만료 알림 끄기" : "만료 알림 켜기"}
                          </button>
                        </form>
                        <DrivePicker />
                      </>
                    )}
                  </>
                )}
              </Connector>

              <Connector
                id="notion"
                name="Notion"
                on={notionToken ? notionSources.length > 0 : null}
                state={!notionToken ? "토큰 없음" : notionSources.length ? `페이지 ${notionSources.length}개` : "가져올 페이지 없음"}
                desc="내부 통합(읽기 전용)으로 연결합니다. 고른 페이지와 그 아래 하위 페이지·데이터베이스를 가져옵니다."
              >
                <HowTo title="연결하는 방법" open={!notionToken}>
                  <li>
                    <a href="https://www.notion.so/profile/integrations" target="_blank" rel="noreferrer">
                      Notion 통합 관리
                    </a>
                    에서 <b>새 통합</b>을 만듭니다. 종류는 <b>내부</b>, 기능은 <b>콘텐츠 읽기</b>만 켭니다.
                  </li>
                  <li>
                    만든 통합의 <b>내부 통합 시크릿</b>을 복사합니다.
                  </li>
                  <TokenSteps name="NOTION_TOKEN" prefix="ntn_" check="통합 이름이 보이면 연결된 것입니다." />
                  <li>
                    Notion 에서 가져올 페이지의 <b>⋯ → 연결(Connections)</b> 에 이 통합을 추가하고, 아래 칸에 그 페이지 주소를 넣습니다.
                  </li>
                </HowTo>
                {!notionToken ? (
                  <p className={err}>.env.local 에 NOTION_TOKEN 이 없습니다.</p>
                ) : (
                  <>
                    <p>{notionWho}</p>
                    {notionSources.map((n) => (
                      <p key={n.id} className="text-muted-foreground">
                        가져오는 중인 페이지: <b className="font-normal text-foreground">{n.name}</b> · 항목 {n.total.toLocaleString()}개
                      </p>
                    ))}
                    <NotionRootForm defaultPage={notionSources.length ? "" : "https://app.notion.com/p/4-3e3533f6b13580518794cd78560ee63c"} />
                    <p className="text-xs text-muted-foreground">가져올 페이지는 Notion 에서 ⋯ → 연결(Connections) → 이 통합을 추가해야 보입니다. 하위 페이지는 자동으로 함께 공유됩니다.</p>
                  </>
                )}
              </Connector>

              <Connector
                id="github"
                name="GitHub"
                on={githubToken ? !!ghWho?.ok : null}
                state={!githubToken ? "토큰 없음" : ghWho?.ok ? "연결됨" : "토큰 오류"}
                desc="내가 소유한 저장소의 README·최근 커밋·이슈·PR 을 가져옵니다."
              >
                {!githubToken ? (
                  <p className={err}>.env.local 에 GITHUB_TOKEN 이 없습니다.</p>
                ) : (
                  <>
                    <p className={ghWho?.ok ? "" : err}>{ghWho?.ok ? `토큰 계정: ${ghWho.message}` : ghWho?.message}</p>
                    {githubSources.map((g) => (
                      <p key={g.id} className="text-muted-foreground">
                        가져오는 중: <b className="font-normal text-foreground">{g.name}</b> · 항목 {g.total.toLocaleString()}개
                      </p>
                    ))}
                    {ghWho?.ok && !githubSources.length && <GitHubImportForm />}
                  </>
                )}
                <HowTo title={githubToken ? "토큰을 새로 넣는 방법" : "연결하는 방법"} open={!githubToken || !ghWho?.ok}>
                  <li>
                    <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">
                      GitHub 새 토큰 만들기
                    </a>
                    를 엽니다 (GitHub → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token).
                  </li>
                  <li>
                    Token name 은 <b>my-hub</b>, Expiration 은 원하는 기간으로 정합니다. 기간이 지나면 이 과정을 다시 합니다.
                  </li>
                  <li>
                    Repository access 는 <b>All repositories</b>를 고릅니다.
                  </li>
                  <li>
                    Permissions 에서 <b>Contents · Issues · Pull requests</b> 를 <b>Read-only</b> 로 추가합니다 (Metadata 는 자동으로 Read-only).
                  </li>
                  <li>
                    <b>Generate token</b> 을 누르고 나온 토큰을 복사합니다. 이 화면을 벗어나면 다시 볼 수 없습니다.
                  </li>
                  <TokenSteps name="GITHUB_TOKEN" prefix="github_pat_" check="“토큰 계정: …” 이 보이면 끝이고, 끊겼던 저장소는 다음 동기화 때 다시 가져옵니다." />
                </HowTo>
              </Connector>

              <Connector
                id="figma"
                name="Figma"
                on={figmaToken ? !!fgWho?.ok : null}
                state={!figmaToken ? "토큰 없음" : fgWho?.ok ? `팀·프로젝트 ${figmaSources.length}개` : "토큰 오류"}
                desc={<>Figma 는 &ldquo;내 파일 전체 목록&rdquo;을 주지 않아 팀·프로젝트 주소를 등록합니다. 기본은 파일 이름·수정 시각·미리보기 이미지만 가져옵니다.</>}
              >
                {!figmaToken ? (
                  <p className={err}>.env.local 에 FIGMA_TOKEN 이 없습니다.</p>
                ) : (
                  <>
                    <p className={fgWho?.ok ? "" : err}>{fgWho?.ok ? `토큰 계정: ${fgWho.message}` : fgWho?.message}</p>
                    {figmaSources.map((f) => {
                      const on = !!(f.config as { fetchText?: boolean }).fetchText;
                      return (
                        <div key={f.id} className="flex flex-wrap items-center gap-2 text-muted-foreground">
                          <b className="font-normal text-foreground">{f.name}</b> · 항목 {f.total.toLocaleString()}개 · 내용 텍스트 {on ? "켜짐" : "꺼짐"}
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
                <HowTo title={figmaToken ? "토큰을 새로 넣는 방법" : "연결하는 방법"} open={!figmaToken || !fgWho?.ok}>
                  <li>
                    Figma 왼쪽 위 계정 메뉴 → <b>Settings → Security → Personal access tokens</b> → <b>Generate new token</b>.
                  </li>
                  <li>
                    권한은 <b>File content</b> 와 <b>Projects</b> 를 <b>Read-only</b> 로 정하고, 나온 토큰을 복사합니다.
                  </li>
                  <TokenSteps name="FIGMA_TOKEN" prefix="figd_" check="“토큰 계정: …” 이 보이면 아래 칸에 팀이나 프로젝트 주소를 넣습니다." />
                </HowTo>
              </Connector>
            </div>
          </Section>

          <Section
            id="tags"
            label="Tags"
            title="태그 합치기"
            desc={
              <>
                비슷한 태그를 허브 안에서 하나로 봅니다 (검색·그래프·태그 목록). 원본 노트는 바꾸지 않습니다. 한 줄에 &ldquo;원래 태그 = 합칠 태그&rdquo;, 하위 태그도 함께 옮겨집니다
                (수업/자료구조 → 학교/자료구조). 줄을 지우면 다음 다시 색인 때 원래 이름으로 돌아옵니다.
              </>
            }
          >
            <form action={saveTagAliases} className="space-y-2">
              <textarea
                name="aliases"
                rows={Math.max(3, Object.keys(s.tagAliases).length + 1)}
                defaultValue={Object.entries(s.tagAliases)
                  .map(([a, b]) => `${a} = ${b}`)
                  .join("\n")}
                placeholder={"수업 = 학교\n코드 = 개발"}
                className={area}
              />
              <Button type="submit" size="sm">
                저장하고 합치기
              </Button>
            </form>
          </Section>

          <Section id="calendar" label="Calendar" title="일정 (Mac 캘린더 앱)" desc="Mac 캘린더 앱에 보이는 일정(iCloud·Google 등 연결된 캘린더 포함)을 허브에 보여 줍니다. 읽기만 하고, 검색 색인·AI 에는 넣지 않습니다.">
            {!s.calendarEnabled ? (
              <form action={connectCalendar} className="space-y-2">
                <p className="text-muted-foreground">
                  &ldquo;연결&rdquo;을 누르면 <b>Mac mini 화면</b>에 &ldquo;나의 허브 캘린더가 캘린더에 접근하려고 합니다&rdquo; 창이 뜹니다. 직접 &ldquo;허용&rdquo;을 눌러 주세요 (2분 안에).
                </p>
                <Button type="submit" size="sm">
                  연결
                </Button>
              </form>
            ) : (
              <>
                <p>
                  {!calSnap
                    ? "일정을 읽는 중… (Mac 화면에 권한 창이 떠 있으면 허용을 눌러 주세요)"
                    : calSnap.status === "ok"
                      ? `연결됨 · 앞으로 ${calSnap.days}일 일정 ${calSnap.events.length}개 · 마지막 확인 ${new Date(calSnap.at).toLocaleString("ko-KR")} (15분마다)`
                      : calSnap.status === "denied"
                        ? "캘린더 접근이 허용되지 않았습니다. 시스템 설정 → 개인정보 보호 및 보안 → 캘린더 에서 '나의 허브 캘린더'(HubCalendar)를 '전체 접근'으로 켠 뒤 다시 확인을 누르세요."
                        : `읽지 못했습니다: ${calSnap.message ?? ""}`}
                </p>
                <div className="flex gap-2">
                  <form action={refreshCalendar}>
                    <Button type="submit" size="sm" variant="outline">
                      지금 다시 확인
                    </Button>
                  </form>
                  <form action={disconnectCalendar}>
                    <Button type="submit" size="sm" variant="ghost">
                      숨기기
                    </Button>
                  </form>
                </div>
                {calSnap?.status === "ok" && calSnap.calendars.length > 0 && (
                  <form action={saveCalendarHidden} className="space-y-2 border-t pt-4">
                    <p className="text-muted-foreground">보일 캘린더</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {[...new Map(calSnap.calendars.map((c) => [c.title, c])).values()].map((c) => (
                        <label key={c.title} className="flex items-center gap-1.5">
                          <input type="hidden" name="all" value={c.title} />
                          <input type="checkbox" name="show" value={c.title} defaultChecked={!s.calendarHidden.includes(c.title)} />
                          <span className="size-2 rounded-full" style={{ background: c.color }} />
                          {c.title} <span className="text-xs text-muted-foreground">{c.source}</span>
                        </label>
                      ))}
                    </div>
                    <Button type="submit" size="sm" variant="outline">
                      저장
                    </Button>
                  </form>
                )}
              </>
            )}
          </Section>

          <Section
            id="chat"
            label="AI Chat"
            title="AI 채팅"
            desc={
              <>
                모델 이름과 외부 전송 한도. API 키는 여기서 넣지 않고 <code>.env.local</code> 에 직접 넣습니다 (ANTHROPIC_API_KEY, OPENAI_API_KEY).
              </>
            }
          >
            <p className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              {(
                [
                  ["Claude 키", hasKey(process.env, "claude")],
                  ["OpenAI 키", hasKey(process.env, "openai")],
                ] as const
              ).map(([k, on]) => (
                <span key={k} className="flex items-center gap-1.5">
                  <span className={`size-1.5 rounded-full ${on ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                  {k} {on ? "있음" : "없음"}
                </span>
              ))}
            </p>
            <form action={saveChatSettings} className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-start gap-2 sm:col-span-2">
                <input type="checkbox" name="externalAiEnabled" defaultChecked={s.externalAiEnabled} className="mt-1" />
                <span>
                  외부 AI(Claude·ChatGPT) 사용 <span className="text-muted-foreground">— 끄면 로컬 AI 만 쓰고, 서버가 외부 요청을 모두 막습니다 (요금 없음)</span>
                </span>
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">로컬 AI 모델 (Ollama)</span>
                <Input name="chatLocalModel" defaultValue={s.chatLocalModel} className="h-9" />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">Claude 모델</span>
                <Input name="chatClaudeModel" defaultValue={s.chatClaudeModel} className="h-9" />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">ChatGPT 모델</span>
                <Input name="chatOpenAiModel" defaultValue={s.chatOpenAiModel} placeholder="예: OpenAI 모델 이름" className="h-9" />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">요청 하나에 보내는 자료 글자 수 상한</span>
                <Input name="chatMaxContextChars" type="number" min={2000} max={60000} defaultValue={s.chatMaxContextChars} className="h-9" />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">하루 외부 AI 요청 횟수 상한</span>
                <Input name="chatDailyExternalLimit" type="number" min={0} max={2000} defaultValue={s.chatDailyExternalLimit} className="h-9" />
              </label>
              <div className="flex items-end">
                <Button type="submit" size="sm">
                  저장
                </Button>
              </div>
            </form>
            <div className="space-y-2 border-t pt-4">
              <p>🔒 외부 AI 전송 금지 목록</p>
              <p className="text-xs text-muted-foreground">소스(위 목록)·폴더·프로젝트·항목 화면의 🔒 버튼으로 지정합니다. 여러 곳에 걸리면 하나라도 금지면 금지이고, 로컬 AI 에는 쓸 수 있습니다.</p>
              {denyRows.length ? (
                <ul className="flex flex-wrap gap-1">
                  {denyRows.map((r) => (
                    <li key={r.k}>
                      <a href={r.href} className="rounded-full border px-2.5 py-0.5 text-xs hover:bg-muted">
                        {r.label}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">지정된 곳이 없습니다.</p>
              )}
            </div>
          </Section>

          <Section id="portfolio" label="Portfolio" title="첫 화면" desc="첫 화면의 자기소개·프로필·프로젝트와 허브의 즐겨찾기는 각 편집 화면에서 바꿉니다.">
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { href: "/profile/edit", en: "Edit Profile", ko: "자기소개·경력·프로젝트·사진" },
                { href: "/home/edit", en: "Edit Hub", ko: "허브 왼쪽 즐겨찾기" },
              ].map((l) => (
                <Link key={l.href} href={l.href} className="group flex items-center justify-between rounded-sm border bg-card px-5 py-4 hover:border-primary">
                  <span>
                    <span className="block text-[11px] uppercase tracking-[0.25em] text-primary">{l.en}</span>
                    <span className="block text-sm text-muted-foreground">{l.ko}</span>
                  </span>
                  <span className="text-muted-foreground transition-transform group-hover:translate-x-1">→</span>
                </Link>
              ))}
            </div>
          </Section>

          <Section id="rules" label="Rules" title="제외 규칙과 동작" desc="숨김 파일·폴더(이름이 .으로 시작)는 항상 제외합니다. 백업 폴더도 자동으로 제외합니다.">
            <form action={saveSettings} className="grid gap-8 xl:grid-cols-2">
              <div className="space-y-4">
                <label className="block space-y-1">
                  <span className="text-xs text-muted-foreground">제외 폴더 (한 줄에 하나)</span>
                  <textarea name="excludedFolders" defaultValue={s.excludedFolders.join("\n")} rows={4} className={area} />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs text-muted-foreground">제외 이름 패턴 (한 줄에 하나, * 사용 가능)</span>
                  <textarea name="excludedPatterns" defaultValue={s.excludedPatterns.join("\n")} rows={6} className={area} />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs text-muted-foreground">폴더 이름 동의어 (프로젝트 연결 제안용, 예: 리뉴얼 = renewal)</span>
                  <textarea name="synonyms" defaultValue={s.synonyms.join("\n")} rows={4} className={area} />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs text-muted-foreground">편집기로 열기 (확장자 = 앱 이름)</span>
                  <textarea
                    name="editorByExt"
                    defaultValue={Object.entries(s.editorByExt)
                      .map(([k, v]) => `${k} = ${v}`)
                      .join("\n")}
                    rows={4}
                    className={area}
                  />
                </label>
              </div>
              <div className="space-y-3">
                <div className="divide-y rounded-sm border bg-card px-4 [&>label]:py-2.5">
                  <NumField name="fullScanIntervalHours" label="전체 재검사 주기" value={s.fullScanIntervalHours} unit="시간" />
                  <NumField name="maxExtractMB" label="본문 추출 파일 크기 상한" value={s.maxExtractMB} unit="MB" />
                  <NumField name="concurrency" label="동시 처리 수" value={s.concurrency} unit="개" />
                  <NumField name="deletedRetentionDays" label="삭제된 항목 보관 기간" value={s.deletedRetentionDays} unit="일" />
                  <NumField name="backupHour" label="자동 백업 시각" value={s.backupHour} unit="시" />
                  <NumField name="backupKeepDaily" label="일간 백업 보관" value={s.backupKeepDaily} unit="개" />
                  <NumField name="backupKeepWeekly" label="주간 백업 보관" value={s.backupKeepWeekly} unit="개" />
                  <NumField name="staleProjectDays" label="쉬고 있는 프로젝트 알림 (0=끔)" value={s.staleProjectDays} unit="일" />
                </div>
                <p className="text-xs text-muted-foreground">
                  백업 위치: <code>{s.backupDir}</code>
                </p>
                <Button type="submit">저장</Button>
              </div>
            </form>
          </Section>
        </div>
      </div>
    </div>
  );
}
