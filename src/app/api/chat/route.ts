import { Ollama, realOllama } from "@/server/ai/ollama";
import { makeLlms, realLlmDeps } from "@/server/chat/llm";
import { ask, QUICK_ACTIONS, type AskEvent, type QuickAction } from "@/server/chat/service";
import { getDb } from "@/server/db";
import type { ChatProvider, ChatScope } from "@/server/db/schema";

/** AI 채팅: 한 줄에 이벤트 하나(JSON)씩 흘려보낸다 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as {
    threadId?: number;
    scope?: ChatScope;
    question?: string;
    provider?: ChatProvider;
    action?: QuickAction;
  } | null;
  if (!b || !b.provider || !["local", "claude", "openai"].includes(b.provider)) return Response.json({ message: "잘못된 요청입니다." }, { status: 400 });
  const scope = parseScope(b.scope);
  if (!scope) return Response.json({ message: "범위가 잘못되었습니다." }, { status: 400 });
  const action = b.action && b.action in QUICK_ACTIONS ? b.action : undefined;
  const db = getDb();
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const emit = (e: AskEvent) => ctrl.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      try {
        await ask(
          db,
          { ai: new Ollama(realOllama()), llms: makeLlms(realLlmDeps()) },
          { threadId: b.threadId ? Number(b.threadId) : undefined, scope, question: String(b.question ?? ""), provider: b.provider!, action },
          emit,
          req.signal,
        );
      } catch (e) {
        emit({ type: "error", message: (e as Error).message });
      }
      ctrl.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}

function parseScope(s: unknown): ChatScope | null {
  const x = s as ChatScope | undefined;
  if (!x || x.kind === "all") return { kind: "all" };
  if (x.kind === "project" && Number(x.projectId) > 0) return { kind: "project", projectId: Number(x.projectId) };
  if (x.kind === "items" && Array.isArray(x.itemIds)) {
    const ids = x.itemIds.map(Number).filter((n) => n > 0).slice(0, 20);
    return ids.length ? { kind: "items", itemIds: ids } : null;
  }
  return null;
}
