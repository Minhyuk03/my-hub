import Link from "next/link";
import { connection } from "next/server";
import { hasModel, Ollama, realOllama } from "@/server/ai/ollama";
import { hasKey } from "@/server/chat/llm";
import { getThread, listThreads, scopeLabel } from "@/server/chat/queries";
import { QUICK_ACTIONS } from "@/server/chat/service";
import { getDb } from "@/server/db";
import type { ChatScope } from "@/server/db/schema";
import { projectList } from "@/server/projects";
import { getSettings } from "@/server/settings";
import { relTime } from "@/lib/format";
import { ChatClient, type ProviderInfo } from "./chat-client";

export default async function ChatPage({ searchParams }: PageProps<"/chat">) {
  await connection();
  const sp = await searchParams;
  const db = getDb();
  const s = getSettings(db);
  const threads = listThreads(db);
  const tid = typeof sp.t === "string" ? Number(sp.t) : 0;
  const thread = tid ? getThread(db, tid) : null;

  let scope: ChatScope = { kind: "all" };
  if (thread) scope = thread.scope;
  else if (typeof sp.project === "string" && Number(sp.project)) scope = { kind: "project", projectId: Number(sp.project) };
  else if (typeof sp.items === "string") {
    const ids = sp.items.split(",").map(Number).filter((n) => n > 0).slice(0, 20);
    if (ids.length) scope = { kind: "items", itemIds: ids };
  }
  const label = scopeLabel(db, scope);

  let localReady = false;
  try {
    localReady = hasModel(await new Ollama(realOllama()).models(), s.chatLocalModel);
  } catch {}
  const providers: ProviderInfo[] = [
    { id: "local", label: "로컬 AI", model: s.chatLocalModel, ready: localReady, note: localReady ? "이 Mac 안에서만 처리" : "Ollama 꺼짐 또는 모델 없음 (외장 디스크 확인)" },
    { id: "claude", label: "Claude", model: s.chatClaudeModel, ready: hasKey(process.env, "claude"), note: hasKey(process.env, "claude") ? "외부 전송 · 금지 자료 제외" : "API 키 없음 (.env.local)" },
    {
      id: "openai",
      label: "ChatGPT",
      model: s.chatOpenAiModel,
      ready: hasKey(process.env, "openai") && !!s.chatOpenAiModel,
      note: !hasKey(process.env, "openai") ? "API 키 없음 (.env.local)" : !s.chatOpenAiModel ? "설정에서 모델 이름을 정하세요" : "외부 전송 · 금지 자료 제외",
    },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <aside className="space-y-2 lg:sticky lg:top-20 lg:self-start">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">대화</h2>
          <Link href="/chat" className="text-sm text-primary hover:underline">
            + 새 대화
          </Link>
        </div>
        <ul className="max-h-[70vh] space-y-0.5 overflow-y-auto text-sm">
          {threads.length === 0 && <li className="text-muted-foreground">아직 대화가 없습니다.</li>}
          {threads.map((t) => (
            <li key={t.id}>
              <Link
                href={`/chat?t=${t.id}`}
                className={`block truncate rounded px-2 py-1 hover:bg-muted ${t.id === tid ? "bg-muted font-medium" : ""}`}
                title={t.title}
              >
                {t.title}
                <span className="ml-1 text-xs text-muted-foreground">{relTime(t.updatedAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/chat/log" className="block text-sm text-muted-foreground hover:text-foreground">
          외부 전송 내역 →
        </Link>
      </aside>
      <ChatClient
        key={thread?.id ?? `new-${JSON.stringify(scope)}`}
        thread={thread ? { id: thread.id, title: thread.title, messages: thread.messages } : null}
        scope={scope}
        scopeLabel={label}
        projects={projectList(db).map((p) => ({ id: p.id, name: p.name }))}
        providers={providers}
        quickActions={Object.entries(QUICK_ACTIONS).map(([id, a]) => ({ id, label: a.label }))}
      />
    </div>
  );
}
