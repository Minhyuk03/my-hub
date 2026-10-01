/**
 * 대화 모델 호출: 로컬(Ollama) · Claude(Anthropic API) · ChatGPT(OpenAI API)
 * - 외부 모델(Claude·OpenAI)은 반드시 gateway.ts 의 sendExternal 을 거쳐서만 부른다.
 * - API 키는 .env.local(ANTHROPIC_API_KEY, OPENAI_API_KEY)에서 읽고, 로그·화면·오류 메시지에 절대 넣지 않는다.
 */
import type { ChatProvider } from "../db/schema";
import { redactSecrets } from "../extract/redact";

export type LlmMessage = { role: "user" | "assistant"; content: string };
export type LlmResult = { text: string; inputTokens?: number; outputTokens?: number };
export type LlmOpts = { onDelta?: (t: string) => void; signal?: AbortSignal; maxTokens?: number };
export interface Llm {
  chat(model: string, system: string, messages: LlmMessage[], opts?: LlmOpts): Promise<LlmResult>;
}
export type LlmDeps = { fetch: typeof fetch; env: Record<string, string | undefined>; ollamaUrl?: string };
export const realLlmDeps = (): LlmDeps => ({ fetch, env: process.env, ollamaUrl: process.env.OLLAMA_URL ?? "http://127.0.0.1:11434" });

export class LlmError extends Error {}

const KEY_ENV: Record<"claude" | "openai", string> = { claude: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" };
export const hasKey = (env: Record<string, string | undefined>, p: "claude" | "openai") => !!env[KEY_ENV[p]]?.trim();

/** 오류 메시지에서 키·토큰을 지운다 */
export function safeError(msg: string, env: Record<string, string | undefined>) {
  let s = msg;
  for (const k of Object.values(KEY_ENV)) {
    const v = env[k]?.trim();
    if (v && v.length > 8) s = s.split(v).join("[가림]");
  }
  return redactSecrets(s).slice(0, 400);
}

/** 줄 단위 스트림 읽기 (NDJSON · SSE 공용) */
async function* lines(res: Response): AsyncGenerator<string> {
  if (!res.body) return;
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const l = buf.slice(0, i).replace(/\r$/, "");
      buf = buf.slice(i + 1);
      if (l) yield l;
    }
  }
  if (buf.trim()) yield buf.trim();
}

async function fail(res: Response, who: string, env: Record<string, string | undefined>): Promise<never> {
  const t = await res.text().catch(() => "");
  let msg = t;
  try {
    const j = JSON.parse(t) as { error?: { message?: string } | string };
    msg = typeof j.error === "string" ? j.error : (j.error?.message ?? t);
  } catch {}
  const hint = res.status === 401 ? " (API 키를 확인하세요)" : res.status === 429 ? " (요청 한도 초과 또는 크레딧 부족)" : "";
  throw new LlmError(`${who} 오류 ${res.status}${hint}: ${safeError(msg, env)}`);
}

export class OllamaLlm implements Llm {
  constructor(private d: LlmDeps) {}
  async chat(model: string, system: string, messages: LlmMessage[], opts: LlmOpts = {}): Promise<LlmResult> {
    let res: Response;
    try {
      res = await this.d.fetch(`${this.d.ollamaUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: system }, ...messages],
          stream: true,
          think: false,
          keep_alive: "10m",
          options: { temperature: 0.2, num_ctx: 8192, num_predict: opts.maxTokens ?? 1500 },
        }),
        signal: opts.signal,
      });
    } catch (e) {
      throw new LlmError(`로컬 AI(Ollama)에 연결할 수 없습니다 (${(e as Error).message})`);
    }
    if (!res.ok) {
      if (res.status === 404) throw new LlmError(`로컬 모델 ${model} 이 없습니다. 외장 디스크(Disk)가 연결되어 있는지 확인하세요.`);
      return fail(res, "로컬 AI", this.d.env);
    }
    let text = "";
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    for await (const l of lines(res)) {
      const j = JSON.parse(l) as { message?: { content?: string }; done?: boolean; prompt_eval_count?: number; eval_count?: number; error?: string };
      if (j.error) throw new LlmError(`로컬 AI 오류: ${j.error}`);
      const t = j.message?.content ?? "";
      if (t) {
        text += t;
        opts.onDelta?.(t);
      }
      if (j.done) {
        inputTokens = j.prompt_eval_count;
        outputTokens = j.eval_count;
      }
    }
    return { text, inputTokens, outputTokens };
  }
}

export class ClaudeLlm implements Llm {
  constructor(private d: LlmDeps) {}
  async chat(model: string, system: string, messages: LlmMessage[], opts: LlmOpts = {}): Promise<LlmResult> {
    const key = this.d.env.ANTHROPIC_API_KEY?.trim();
    if (!key) throw new LlmError("Claude API 키가 없습니다. .env.local 에 ANTHROPIC_API_KEY 를 넣고 서비스를 다시 시작하세요.");
    let res: Response;
    try {
      res = await this.d.fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, system, messages, max_tokens: opts.maxTokens ?? 2000, stream: true }),
        signal: opts.signal,
      });
    } catch (e) {
      throw new LlmError(`Claude 에 연결할 수 없습니다 (${safeError((e as Error).message, this.d.env)})`);
    }
    if (!res.ok) return fail(res, "Claude", this.d.env);
    let text = "";
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    for await (const l of lines(res)) {
      if (!l.startsWith("data:")) continue;
      const j = JSON.parse(l.slice(5)) as {
        type: string;
        delta?: { type?: string; text?: string };
        message?: { usage?: { input_tokens?: number; output_tokens?: number } };
        usage?: { output_tokens?: number };
        error?: { message?: string };
      };
      if (j.type === "error") throw new LlmError(`Claude 오류: ${safeError(j.error?.message ?? "", this.d.env)}`);
      if (j.type === "message_start") inputTokens = j.message?.usage?.input_tokens;
      if (j.type === "content_block_delta" && j.delta?.type === "text_delta" && j.delta.text) {
        text += j.delta.text;
        opts.onDelta?.(j.delta.text);
      }
      if (j.type === "message_delta") outputTokens = j.usage?.output_tokens;
    }
    return { text, inputTokens, outputTokens };
  }
}

export class OpenAiLlm implements Llm {
  constructor(private d: LlmDeps) {}
  async chat(model: string, system: string, messages: LlmMessage[], opts: LlmOpts = {}): Promise<LlmResult> {
    const key = this.d.env.OPENAI_API_KEY?.trim();
    if (!key) throw new LlmError("OpenAI API 키가 없습니다. .env.local 에 OPENAI_API_KEY 를 넣고 서비스를 다시 시작하세요.");
    let res: Response;
    try {
      res = await this.d.fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: system }, ...messages],
          max_completion_tokens: opts.maxTokens ?? 4000,
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal: opts.signal,
      });
    } catch (e) {
      throw new LlmError(`OpenAI 에 연결할 수 없습니다 (${safeError((e as Error).message, this.d.env)})`);
    }
    if (!res.ok) return fail(res, "OpenAI", this.d.env);
    let text = "";
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    for await (const l of lines(res)) {
      if (!l.startsWith("data:")) continue;
      const data = l.slice(5).trim();
      if (data === "[DONE]") break;
      const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      const t = j.choices?.[0]?.delta?.content;
      if (t) {
        text += t;
        opts.onDelta?.(t);
      }
      if (j.usage) {
        inputTokens = j.usage.prompt_tokens;
        outputTokens = j.usage.completion_tokens;
      }
    }
    return { text, inputTokens, outputTokens };
  }
}

export type Llms = Record<ChatProvider, Llm>;
export const makeLlms = (d: LlmDeps): Llms => ({ local: new OllamaLlm(d), claude: new ClaudeLlm(d), openai: new OpenAiLlm(d) });
