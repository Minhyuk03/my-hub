import Link from "next/link";
import { SettingsTabs } from "@/components/settings-tabs";
import { connection } from "next/server";
import { eq } from "drizzle-orm";
import { SourceIcon } from "@/components/hub-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { relTime, shortPath } from "@/lib/format";
import { AI_KINDS } from "@/server/ai/pipeline";
import { getDb } from "@/server/db";
import { runtime } from "@/server/db/schema";
import { tagEmojiMap } from "@/server/graph";
import { getSettings } from "@/server/settings";
import { acceptProject, acceptProjectsAll, acceptTagsAll, rejectAi, runAiNow, saveAiSettings, setAiEnabled } from "./actions";
import { TagChips } from "./tag-chips";
import { ChatUpload } from "./chat-upload";
import { addClaudeCodeSessions, acceptParaMoveAction, findParaMoves, rejectParaMoveAction } from "./actions";
import { pendingParaMoves } from "@/server/projects/para-moves";
import { ConfirmSubmit } from "@/app/settings/confirm-submit";

const STATUS: Record<string, string> = {
  ok: "정상",
  off: "꺼짐",
  offline: "Ollama 꺼짐 — Ollama 앱을 실행하세요",
  no_model: "모델 없음 — 외장 디스크(Disk) 연결을 확인하세요",
  error: "오류",
};
const PARA: Record<string, string> = { project: "프로젝트", area: "영역", resource: "자료", archive: "보관" };

type Row = { id: number; itemId: number; payload: string; title: string; path: string; sourceKind: string; modifiedAt: number | null };

export default async function AiPage() {
  await connection();
  const db = getDb();
  const s = getSettings(db);
  const c = db.$client;
  const rt = db.select().from(runtime).where(eq(runtime.key, "ai")).get();
  const last = rt?.value as { status: string; message?: string; at: number; embedded: number; projectSuggested: number; tagged: number } | undefined;
  const counts = c
    .prepare(
      `SELECT (SELECT count(*) FROM items WHERE state != 'deleted' AND kind IN (${AI_KINDS.map(() => "?").join(",")})) AS eligible,
              (SELECT count(*) FROM item_embeddings) AS embedded,
              (SELECT count(*) FROM ai_suggestions WHERE kind = 'tags') AS tagDone,
              (SELECT count(*) FROM items i JOIN item_text t ON t.item_id = i.id WHERE i.state = 'ok' AND i.kind IN ('note','document','pdf') AND length(t.body) >= 200) AS tagEligible`,
    )
    .get(...AI_KINDS) as { eligible: number; embedded: number; tagDone: number; tagEligible: number };
  const q = (kind: string) =>
    c
      .prepare(
        `SELECT a.id, a.item_id AS itemId, a.payload, i.title, i.path, s.kind AS sourceKind, i.modified_at AS modifiedAt
         FROM ai_suggestions a JOIN items i ON i.id = a.item_id JOIN sources s ON s.id = i.source_id
         WHERE a.kind = ? AND a.status = 'pending' AND i.state != 'deleted' ORDER BY i.modified_at DESC LIMIT 100`,
      )
      .all(kind) as Row[];
  const tagRows = q("tags").map((r) => ({ ...r, p: JSON.parse(r.payload) as { tags: string[]; summary: string; para?: string } }));
  const projRows = q("project")
    .map((r) => ({ ...r, p: JSON.parse(r.payload) as { projectId: number; score: number } }))
    .sort((a, b) => b.p.score - a.p.score);
  const sure = projRows.filter((r) => r.p.score >= 0.75);
  const paraRows = pendingParaMoves(db);
  const paraFailed = db.$client.prepare(`SELECT to_path AS toPath, message FROM para_moves WHERE status = 'failed' ORDER BY decided_at DESC LIMIT 3`).all() as { toPath: string; message: string }[];
  const projectNames = new Map((c.prepare(`SELECT id, name FROM projects`).all() as { id: number; name: string }[]).map((p) => [p.id, p.name]));
  const currentTags = new Map<number, string[]>();
  for (const r of c.prepare(`SELECT it.item_id AS id, g.name FROM v_item_tags it JOIN tags g ON g.id = it.tag_id`).all() as { id: number; name: string }[])
    currentTags.set(r.id, [...(currentTags.get(r.id) ?? []), r.name]);
  const emoji = Object.fromEntries(tagEmojiMap(db));
  const chatSources = c
    .prepare(`SELECT s.id, s.name, s.root_path AS root, (SELECT count(*) FROM items i WHERE i.source_id = s.id AND i.state != 'deleted') AS n FROM sources s WHERE s.kind = 'ai'`)
    .all() as { id: number; name: string; root: string; n: number }[];
  const hasClaudeCode = chatSources.some((x) => !x.root.startsWith("chat:"));
  const lastImport = db.select().from(runtime).where(eq(runtime.key, "chat_import")).get()?.value as { result: string; at: number } | undefined;
  const chunkCount = c.prepare(`SELECT count(*) FROM item_chunks`).pluck().get() as number;

  return (
    <div className="space-y-4">
      <SettingsTabs current="/ai" />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">AI 정리</h1>
        <span className="text-sm text-muted-foreground">이 Mac 의 로컬 AI 가 태그·프로젝트를 제안합니다. 수락한 것만 적용되고, 외부로 아무것도 보내지 않습니다.</span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            상태: {s.aiEnabled ? (STATUS[last?.status ?? "ok"] ?? last?.status) : "꺼짐"}
            <span className="ml-auto flex gap-2">
              {s.aiEnabled && (
                <form action={runAiNow}>
                  <Button type="submit" size="sm" variant="outline">
                    지금 실행
                  </Button>
                </form>
              )}
              <form action={setAiEnabled.bind(null, !s.aiEnabled)}>
                <Button type="submit" size="sm" variant={s.aiEnabled ? "ghost" : "default"}>
                  {s.aiEnabled ? "끄기" : "켜기"}
                </Button>
              </form>
            </span>
          </CardTitle>
          <CardDescription>
            태그·요약 {s.aiChatModel} · 비슷한 문서 {s.aiEmbedModel} · 인덱서가 쉬는 동안 1분마다 {s.aiBatchSize}개씩 처리
            {last?.at ? ` · 마지막 실행 ${relTime(last.at)}` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {last?.message && <p className="text-destructive">{last.message}</p>}
          <p>
            비슷한 문서 분석 {counts.embedded.toLocaleString()} / {counts.eligible.toLocaleString()} · 의미 검색 조각 {chunkCount.toLocaleString()}개 · 태그 분석 {Math.min(counts.tagDone, counts.tagEligible).toLocaleString()} /{" "}
            {counts.tagEligible.toLocaleString()} (본문이 있는 문서만)
          </p>
          <details>
            <summary className="cursor-pointer text-muted-foreground">세부 설정</summary>
            <form action={saveAiSettings} className="mt-2 grid max-w-xl gap-2">
              <label className="flex items-center justify-between gap-2">
                프로젝트 제안 기준 유사도 (높을수록 엄격)
                <Input name="threshold" type="number" step="0.01" defaultValue={s.aiProjectThreshold} className="h-8 w-24" />
              </label>
              <label className="flex items-center justify-between gap-2">
                1분마다 태그를 제안할 문서 수
                <Input name="batch" type="number" defaultValue={s.aiBatchSize} className="h-8 w-24" />
              </label>
              <label className="flex items-center justify-between gap-2">
                제안하지 않을 구조용 태그 (쉼표로)
                <Input name="structural" defaultValue={s.aiStructuralTags.join(", ")} className="h-8 w-56" />
              </label>
              <Button type="submit" size="sm" variant="outline" className="w-fit">
                저장
              </Button>
            </form>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AI 대화 기록</CardTitle>
          <CardDescription>
            Claude Code 세션과 claude.ai·ChatGPT 대화를 검색할 수 있게 가져옵니다. 토큰 같은 비밀 값은 가리고, 이 기록들은 외부 AI 로 보내지 않도록 표시합니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {chatSources.map((x) => (
            <p key={x.id}>
              <b>{x.name}</b> · 대화 {x.n.toLocaleString()}개
            </p>
          ))}
          {!hasClaudeCode && (
            <form action={addClaudeCodeSessions}>
              <Button type="submit" size="sm" variant="outline">
                Claude Code 세션 가져오기 (~/.claude/projects)
              </Button>
            </form>
          )}
          <div className="space-y-1">
            <p className="font-medium">claude.ai · ChatGPT 내보내기 파일</p>
            <p className="text-xs text-muted-foreground">
              claude.ai: 설정 → 개인정보 → 데이터 내보내기 · ChatGPT: 설정 → 데이터 제어 → 데이터 내보내기. 메일로 받은 zip 을 그대로 올리세요. 다시 올리면 바뀐 대화만 갱신합니다.
            </p>
            <ChatUpload />
            {lastImport && (
              <p className="text-xs text-muted-foreground">
                마지막 가져오기 ({relTime(lastImport.at)}): {lastImport.result}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            프로젝트 제안 ({projRows.length})
            {sure.length > 0 && sure.length < projRows.length && (
              <form action={acceptProjectsAll.bind(null, sure.map((r) => r.id))} className="ml-auto">
                <Button type="submit" size="sm" variant="outline">
                  유사도 75% 이상 {sure.length}개 수락
                </Button>
              </form>
            )}
            {projRows.length > 1 && (
              <form action={acceptProjectsAll.bind(null, projRows.map((r) => r.id))} className={sure.length > 0 && sure.length < projRows.length ? "" : "ml-auto"}>
                <Button type="submit" size="sm" variant="outline">
                  모두 수락
                </Button>
              </form>
            )}
          </CardTitle>
          <CardDescription>프로젝트에 속한 문서들과 비슷한 문서입니다 (유사도 높은 순). 수락하면 그 프로젝트에 개별 항목으로 추가됩니다.</CardDescription>
        </CardHeader>
        <CardContent className="divide-y text-sm">
          {!projRows.length && <p className="text-muted-foreground">제안이 없습니다.</p>}
          {projRows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 py-2">
              <SourceIcon kind={r.sourceKind} />
              <Link href={`/items/${r.itemId}`} className="max-w-[40%] truncate font-medium hover:underline" title={shortPath(r.path)}>
                {r.title}
              </Link>
              <span className="text-muted-foreground">→</span>
              <Link href={`/projects/${r.p.projectId}`} className="truncate hover:underline">
                {projectNames.get(r.p.projectId) ?? "(없는 프로젝트)"}
              </Link>
              <span className="text-xs text-muted-foreground">유사도 {Math.round(r.p.score * 100)}%</span>
              <span className="ml-auto flex gap-1">
                <form action={acceptProject.bind(null, r.id)}>
                  <Button type="submit" size="sm" className="h-6 px-2 text-xs">
                    수락
                  </Button>
                </form>
                <form action={rejectAi.bind(null, [r.id])}>
                  <Button type="submit" size="sm" variant="ghost" className="h-6 px-2 text-xs">
                    거절
                  </Button>
                </form>
              </span>
              <span className="w-full truncate pl-6 text-xs text-muted-foreground">{shortPath(r.path)}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            Obsidian 노트 정리 제안 ({paraRows.length})
            <form action={findParaMoves} className="ml-auto">
              <Button type="submit" size="sm" variant="outline">
                제안 다시 찾기
              </Button>
            </form>
          </CardTitle>
          <CardDescription>
            완료한 프로젝트 폴더는 4. Archives 로, PARA 폴더 밖의 노트는 비슷한 노트들이 있는 폴더로 옮기자고 제안합니다. <b>&ldquo;옮기기&rdquo;를 누른 것만</b> 실제로
            옮기고, 새 폴더는 만들지 않으며, 같은 이름이 있으면 옮기지 않습니다. 프로젝트 연결은 그대로 유지됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y text-sm">
          {!paraRows.length && <p className="text-muted-foreground">제안이 없습니다.</p>}
          {paraRows.map((m) => (
            <div key={m.id} className="space-y-1 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-muted px-1.5 text-xs">{m.kind === "archive" ? "폴더 보관" : "노트 이동"}</span>
                <span className="text-xs text-muted-foreground">{m.reason}</span>
                <span className="ml-auto flex gap-1">
                  <form action={acceptParaMoveAction.bind(null, m.id)}>
                    <ConfirmSubmit message={`옮길까요?\n\n${m.fromLabel}\n→ ${m.toLabel}`}>옮기기</ConfirmSubmit>
                  </form>
                  <form action={rejectParaMoveAction.bind(null, m.id)}>
                    <Button type="submit" size="sm" variant="ghost" className="h-6 px-2 text-xs">
                      거절
                    </Button>
                  </form>
                </span>
              </div>
              <div className="break-all text-xs">
                <span className="text-muted-foreground">지금</span> {m.fromLabel}
                <br />
                <span className="text-muted-foreground">옮길 곳</span> <b>{m.toLabel}</b>
              </div>
            </div>
          ))}
          {paraFailed.map((f, i) => (
            <p key={i} className="py-1 text-xs text-destructive">
              옮기지 못함: {f.message}
            </p>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            태그·요약 제안 ({tagRows.length})
            {tagRows.length > 1 && (
              <form action={acceptTagsAll.bind(null, tagRows.map((r) => ({ id: r.id, tags: r.p.tags })))} className="ml-auto">
                <Button type="submit" size="sm" variant="outline">
                  모두 수락
                </Button>
              </form>
            )}
          </CardTitle>
          <CardDescription>
            태그를 눌러 빼고 &ldquo;수락&rdquo;하면 고른 태그만 붙습니다. 허브 안에서만 붙는 태그이며, Obsidian 노트 파일은 바꾸지 않습니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y text-sm">
          {!tagRows.length && <p className="text-muted-foreground">제안이 없습니다.</p>}
          {tagRows.map((r) => (
            <div key={r.id} className="space-y-1 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <SourceIcon kind={r.sourceKind} />
                <Link href={`/items/${r.itemId}`} className="truncate font-medium hover:underline">
                  {r.title}
                </Link>
                {r.p.para && <span className="rounded bg-muted px-1.5 text-xs text-muted-foreground">{PARA[r.p.para] ?? r.p.para}</span>}
                {(currentTags.get(r.itemId) ?? []).map((t) => (
                  <span key={t} className="text-xs text-muted-foreground">
                    #{t}
                  </span>
                ))}
              </div>
              {r.p.summary && <p className="pl-6 text-muted-foreground">{r.p.summary}</p>}
              <div className="pl-6">
                <TagChips id={r.id} tags={r.p.tags} emoji={emoji} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
