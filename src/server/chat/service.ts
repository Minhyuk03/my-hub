/**
 * AI 채팅 흐름: 자료 찾기 → 정책 적용 → 모델 호출 → 답·출처(원문 사본) 저장
 * - 외부 모델이면 금지 자료를 빼고(뺀 개수 기록), 관문(sendExternal)을 거쳐 보낸다.
 * - 로컬 모델은 금지 자료도 쓰되, 그 답은 local_only 로 표시해 이후 외부 요청 이력에서 빠지게 한다.
 * - 근거가 부족하면 모델을 부르지 않고 "근거가 부족합니다"라고 답한다.
 */
import { asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db";
import { chatCitations, chatMessages, chatThreads, runtime, type ChatProvider, type ChatScope } from "../db/schema";
import type { Ollama } from "../ai/ollama";
import { getSettings } from "../settings";
import { sendExternal, PolicyError, type GatewayContext } from "./gateway";
import { LlmError, type LlmMessage, type Llms } from "./llm";
import { deniedItems } from "./policy";
import { citedNumbers, INSUFFICIENT, SYSTEM_PROMPT, userTurn } from "./prompt";
import { retrieve, type Strategy } from "./retrieve";

export type QuickAction = "summary" | "status" | "todo";
export const QUICK_ACTIONS: Record<QuickAction, { label: string; question: string }> = {
  summary: { label: "요약", question: "이 자료들의 핵심 내용을 요약해 주세요." },
  status: { label: "프로젝트 현황 정리", question: "이 자료들을 바탕으로 프로젝트의 현재 진행 상황, 최근 한 일, 남은 과제, 문제점을 정리해 주세요." },
  todo: { label: "할 일 뽑기", question: "이 자료들에서 해야 할 일(할 일, TODO, 마감, 담당)을 목록으로 뽑아 주세요." },
};

export type AskInput = { threadId?: number; scope: ChatScope; question: string; provider: ChatProvider; model?: string; action?: QuickAction };
export type AskEvent =
  | { type: "start"; threadId: number; messageId: number; contexts: { n: number; itemId: number; title: string; path: string }[]; excluded: number; localOnly: boolean }
  | { type: "delta"; text: string }
  | { type: "done"; messageId: number; insufficient: boolean; cited: number[] }
  | { type: "error"; message: string; messageId?: number };

export type ChatDeps = { ai: Ollama | null; llms: Llms; now?: () => number };

export function modelFor(db: Db, provider: ChatProvider) {
  const s = getSettings(db);
  return provider === "local" ? s.chatLocalModel : provider === "claude" ? s.chatClaudeModel : s.chatOpenAiModel;
}

function strategyFor(action: QuickAction | undefined, scope: ChatScope): Strategy {
  if (!action) return "search";
  if (scope.kind === "items") return "whole";
  return "recent"; // 프로젝트·전체: 최근 수정한 자료
}

/** 채팅 중에는 백그라운드 AI 정리를 잠시 멈춘다 (16GB 메모리) */
function markChatActive(db: Db, now: number) {
  const value = { until: now + 5 * 60_000 };
  db.insert(runtime).values({ key: "chat_active", value, updatedAt: now }).onConflictDoUpdate({ target: runtime.key, set: { value, updatedAt: now } }).run();
}

export async function ask(db: Db, deps: ChatDeps, input: AskInput, emit: (e: AskEvent) => void = () => {}, signal?: AbortSignal): Promise<{ threadId: number; messageId: number }> {
  const now = deps.now ?? Date.now;
  const s = getSettings(db);
  const provider = input.provider;
  const model = input.model || modelFor(db, provider);
  const question = (input.question || (input.action ? QUICK_ACTIONS[input.action].question : "")).trim().slice(0, 4000);
  if (!question) throw new Error("질문을 입력하세요.");
  if (provider !== "local" && !model) throw new Error("설정에서 사용할 모델 이름을 먼저 정하세요.");

  // 대화
  let threadId = input.threadId;
  if (threadId) {
    const t = db.select().from(chatThreads).where(eq(chatThreads.id, threadId)).get();
    if (!t) throw new Error("대화를 찾을 수 없습니다.");
    db.update(chatThreads).set({ updatedAt: now() }).where(eq(chatThreads.id, threadId)).run();
  } else {
    const title = (input.action ? `${QUICK_ACTIONS[input.action].label}: ` : "") + question.split("\n")[0].slice(0, 60);
    threadId = db.insert(chatThreads).values({ title, scope: input.scope, createdAt: now(), updatedAt: now() }).returning({ id: chatThreads.id }).get().id;
  }
  const scope = db.select().from(chatThreads).where(eq(chatThreads.id, threadId)).get()!.scope;
  db.insert(chatMessages).values({ threadId, role: "user", content: question, createdAt: now() }).run();
  const msgId = db.insert(chatMessages).values({ threadId, role: "assistant", content: "", provider, model, createdAt: now() }).returning({ id: chatMessages.id }).get().id;
  const finish = (patch: Partial<typeof chatMessages.$inferInsert>) => db.update(chatMessages).set(patch).where(eq(chatMessages.id, msgId)).run();

  try {
    if (provider === "local") markChatActive(db, now());
    const external = provider !== "local";
    const r = await retrieve(db, deps.ai, s.aiEmbedModel, question, scope, {
      strategy: strategyFor(input.action, scope),
      maxChars: external ? s.chatMaxContextChars : Math.min(s.chatMaxContextChars, 6000),
    });
    const denied = deniedItems(db, r.contexts.map((c) => c.itemId));
    let contexts: GatewayContext[] = r.contexts;
    let excluded = 0;
    if (external) {
      contexts = r.contexts.filter((c) => !denied.has(c.itemId));
      excluded = new Set(r.contexts.filter((c) => denied.has(c.itemId)).map((c) => c.itemId)).size;
      contexts = contexts.map((c, i) => ({ ...c, n: i + 1 }));
    }
    // 로컬 답이 금지 자료나 금지 자료에서 나온 이전 답을 썼으면 이 답도 금지(파생 데이터)
    const history = localHistory(db, threadId, msgId);
    const localOnly = !external && (contexts.some((c) => denied.has(c.itemId)) || history.tainted);
    finish({ localOnly, excludedCount: excluded });
    emit({ type: "start", threadId, messageId: msgId, contexts: contexts.map(({ n, itemId, title, path }) => ({ n, itemId, title, path })), excluded, localOnly });

    if (!r.strong || !contexts.length) {
      const why =
        external && excluded && !contexts.length
          ? `${INSUFFICIENT} 관련 자료 ${excluded}개가 외부 전송 금지라 보내지 않았습니다. 로컬 AI 로 물어보세요.`
          : `${INSUFFICIENT} ${scope.kind === "all" ? "허브" : "선택한 범위"}에서 질문과 관련된 자료를 찾지 못했습니다.`;
      finish({ content: why, insufficient: true });
      saveCitations(db, msgId, contexts, why);
      emit({ type: "delta", text: why });
      emit({ type: "done", messageId: msgId, insufficient: true, cited: [] });
      return { threadId, messageId: msgId };
    }

    let text = "";
    const onDelta = (t: string) => {
      text += t;
      emit({ type: "delta", text: t });
    };
    if (external) {
      await sendExternal(db, deps.llms, { provider, model, threadId, messageId: msgId, question, contexts, dailyLimit: s.chatDailyExternalLimit }, { onDelta, signal }, now());
    } else {
      await deps.llms.local.chat(model, SYSTEM_PROMPT, [...history.messages, { role: "user", content: userTurn(contexts, question) }], { onDelta, signal });
    }
    const cited = citedNumbers(text, contexts.length);
    const insufficient = text.trim().startsWith(INSUFFICIENT.replace(/\.$/, ""));
    finish({ content: text, insufficient });
    saveCitations(db, msgId, contexts, text);
    emit({ type: "done", messageId: msgId, insufficient, cited: [...cited] });
    return { threadId, messageId: msgId };
  } catch (e) {
    const message = e instanceof PolicyError || e instanceof LlmError ? e.message : `오류: ${(e as Error).message}`;
    finish({ error: message });
    emit({ type: "error", message, messageId: msgId });
    return { threadId, messageId: msgId };
  }
}

/** 로컬 모델에 주는 이력 (전부) + 그중 금지 자료에서 나온 답이 있는지 */
function localHistory(db: Db, threadId: number, beforeId: number): { messages: LlmMessage[]; tainted: boolean } {
  const msgs = db.select().from(chatMessages).where(eq(chatMessages.threadId, threadId)).orderBy(asc(chatMessages.id)).all().filter((m) => m.id < beforeId);
  const out: LlmMessage[] = [];
  let tainted = false;
  for (let i = 0; i + 1 < msgs.length; i++) {
    const q = msgs[i];
    const a = msgs[i + 1];
    if (q.role !== "user" || a.role !== "assistant") continue;
    i++;
    if (a.error || !a.content.trim()) continue;
    if (a.localOnly) tainted = true;
    out.push({ role: "user", content: q.content }, { role: "assistant", content: a.content });
  }
  // 지금 기준으로 금지된 항목을 인용한 이전 답도 금지 파생물
  const ids = msgs.filter((m) => m.role === "assistant").map((m) => m.id);
  if (!tainted && ids.length) {
    const items = db.select({ itemId: chatCitations.itemId }).from(chatCitations).where(inArray(chatCitations.messageId, ids)).all();
    tainted = deniedItems(db, items.map((x) => x.itemId)).size > 0;
  }
  return { messages: out.slice(-12), tainted };
}

function saveCitations(db: Db, messageId: number, contexts: GatewayContext[], answer: string) {
  const cited = citedNumbers(answer, contexts.length);
  for (const c of contexts)
    db.insert(chatCitations)
      .values({ messageId, n: c.n, itemId: c.itemId, chunkId: c.chunkId, title: c.title, path: c.path, quote: c.text, cited: cited.has(c.n) })
      .run();
}
