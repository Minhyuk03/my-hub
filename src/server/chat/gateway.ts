/**
 * 외부 AI 전송 관문 (6장). Claude·OpenAI 로 나가는 요청은 모두 여기를 지난다.
 * - 보내기 직전에 자료마다 정책을 다시 확인하고, 금지 자료가 하나라도 있으면 요청 전체를 막는다 (앞 단계에서 이미 뺐어야 함 → 이중 확인).
 * - 대화 이력은 DB 에서 직접 읽고, 금지 자료에서 나온 답(local_only, 또는 지금 기준으로 금지된 항목을 인용한 답)은 뺀다.
 * - 보내기 전에 전송 기록(external_log)을 남기고, 끝나면 결과·토큰 수를 고친다.
 */
import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import type { Db } from "../db";
import { chatCitations, chatMessages, externalLog } from "../db/schema";
import type { LlmMessage, LlmOpts, LlmResult, Llms } from "./llm";
import { deniedItems } from "./policy";
import { SYSTEM_PROMPT, userTurn, type PromptContext } from "./prompt";

export type GatewayContext = PromptContext & { itemId: number; chunkId: number | null };
export type ExternalRequest = {
  provider: "claude" | "openai";
  model: string;
  threadId: number;
  /** 지금 만드는 답 메시지 (이력에서 제외, 기록에 연결) */
  messageId: number | null;
  question: string;
  contexts: GatewayContext[];
  dailyLimit: number;
};

export class PolicyError extends Error {}

const MAX_HISTORY_PAIRS = 6;

/** 외부로 보내도 되는 대화 이력 (질문-답 쌍) */
export function externalHistory(db: Db, threadId: number, beforeMessageId: number | null): LlmMessage[] {
  const where = beforeMessageId ? and(eq(chatMessages.threadId, threadId), lt(chatMessages.id, beforeMessageId)) : eq(chatMessages.threadId, threadId);
  const msgs = db.select().from(chatMessages).where(where).orderBy(asc(chatMessages.id)).all();
  const answerIds = msgs.filter((m) => m.role === "assistant").map((m) => m.id);
  const cites = answerIds.length ? db.select({ messageId: chatCitations.messageId, itemId: chatCitations.itemId }).from(chatCitations).where(inArray(chatCitations.messageId, answerIds)).all() : [];
  const denied = deniedItems(db, cites.map((c) => c.itemId));
  const tainted = new Set(cites.filter((c) => denied.has(c.itemId)).map((c) => c.messageId));
  const pairs: LlmMessage[][] = [];
  for (let i = 0; i < msgs.length; i++) {
    const q = msgs[i];
    const a = msgs[i + 1];
    if (q.role !== "user" || !a || a.role !== "assistant") continue;
    i++;
    if (a.localOnly || a.error || a.insufficient || tainted.has(a.id) || !a.content.trim()) continue;
    pairs.push([
      { role: "user", content: q.content },
      { role: "assistant", content: a.content },
    ]);
  }
  return pairs.slice(-MAX_HISTORY_PAIRS).flat();
}

const startOfDay = (now: number) => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export function externalCountToday(db: Db, now = Date.now()) {
  return db
    .select({ id: externalLog.id, status: externalLog.status })
    .from(externalLog)
    .where(gte(externalLog.createdAt, startOfDay(now)))
    .all()
    .filter((r) => r.status === "ok" || r.status === "sending").length;
}

export async function sendExternal(db: Db, llms: Llms, req: ExternalRequest, opts: LlmOpts = {}, now = Date.now()): Promise<LlmResult & { logId: number }> {
  const itemIds = [...new Set(req.contexts.map((c) => c.itemId))];
  const chunkIds = req.contexts.map((c) => c.chunkId).filter((x): x is number => x != null);
  const history = externalHistory(db, req.threadId, req.messageId);
  const userMsg = userTurn(req.contexts, req.question);
  const chars = SYSTEM_PROMPT.length + userMsg.length + history.reduce((n, m) => n + m.content.length, 0);
  const base = { createdAt: now, provider: req.provider, model: req.model, threadId: req.threadId, messageId: req.messageId, question: req.question, itemIds, chunkIds, historyCount: history.length, chars };

  const denied = deniedItems(db, itemIds);
  if (denied.size) {
    db.insert(externalLog).values({ ...base, status: "blocked", error: `외부 전송 금지 항목 ${denied.size}개가 포함되어 막음` }).run();
    throw new PolicyError("외부 전송 금지 자료가 포함되어 요청을 보내지 않았습니다.");
  }
  if (externalCountToday(db, now) >= req.dailyLimit) {
    db.insert(externalLog).values({ ...base, status: "blocked", error: "하루 외부 요청 한도 초과" }).run();
    throw new PolicyError(`오늘 외부 AI 요청 한도(${req.dailyLimit}회)를 다 썼습니다. 설정에서 바꿀 수 있습니다.`);
  }

  const logId = db.insert(externalLog).values({ ...base, status: "sending" }).returning({ id: externalLog.id }).get().id;
  try {
    const r = await llms[req.provider].chat(req.model, SYSTEM_PROMPT, [...history, { role: "user", content: userMsg }], opts);
    db.update(externalLog).set({ status: "ok", inputTokens: r.inputTokens ?? null, outputTokens: r.outputTokens ?? null }).where(eq(externalLog.id, logId)).run();
    return { ...r, logId };
  } catch (e) {
    db.update(externalLog).set({ status: "error", error: (e as Error).message.slice(0, 400) }).where(eq(externalLog.id, logId)).run();
    throw e;
  }
}
