/**
 * 로컬 Ollama (http://127.0.0.1:11434) 호출. 이 Mac 안에서만 실행되며 외부로 아무것도 보내지 않는다.
 * 모델 파일은 외장 디스크(/Volumes/Disk/ollama/models)에 있으므로, 디스크가 없으면 "모델 없음"이 된다.
 */
export type OllamaDeps = { fetch: typeof fetch; baseUrl: string };
export const realOllama = (): OllamaDeps => ({ fetch, baseUrl: process.env.OLLAMA_URL ?? "http://127.0.0.1:11434" });

/** 백그라운드 임베딩 한 번에 보내는 개수. Ollama 는 요청을 하나씩 처리하므로 작게 나눠야 검색어 임베딩이 오래 기다리지 않는다 */
export const EMBED_BATCH = 8;

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export class OllamaError extends Error {
  constructor(
    message: string,
    public kind: "offline" | "no_model" | "error",
  ) {
    super(message);
  }
}

export class Ollama {
  constructor(private d: OllamaDeps) {}

  private async post<T>(p: string, body: unknown, timeoutMs = 300_000): Promise<T> {
    let r: Response;
    try {
      r = await this.d.fetch(this.d.baseUrl + p, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new OllamaError(`Ollama 에 연결할 수 없습니다 (${(e as Error).message})`, "offline");
    }
    if (!r.ok) {
      const t = await r.text();
      if (r.status === 404 || /not found/i.test(t)) throw new OllamaError("모델이 없습니다. 외장 디스크(Disk)가 연결되어 있는지 확인하세요.", "no_model");
      throw new OllamaError(`Ollama 오류 ${r.status}: ${t.slice(0, 200)}`, "error");
    }
    return r.json() as Promise<T>;
  }

  /** 설치된 모델 목록 (연결 확인 겸용) */
  async models(): Promise<string[]> {
    try {
      const r = await this.d.fetch(this.d.baseUrl + "/api/tags", { signal: AbortSignal.timeout(3000) });
      const j = (await r.json()) as { models?: { name: string }[] };
      return (j.models ?? []).map((m) => m.name);
    } catch (e) {
      throw new OllamaError(`Ollama 에 연결할 수 없습니다 (${(e as Error).message})`, "offline");
    }
  }

  async embed(model: string, input: string[], keepAlive = "60m"): Promise<number[][]> {
    // 검색어 임베딩이 바로 되도록 임베딩 모델은 오래 올려 둔다 (1.6GB)
    const r = await this.post<{ embeddings: number[][] }>("/api/embed", { model, input, keep_alive: keepAlive, truncate: true });
    return r.embeddings;
  }

  /** JSON 형식(스키마)으로 답하게 한다 */
  async chatJson<T>(model: string, messages: ChatMessage[], schema: object): Promise<T> {
    const r = await this.post<{ message: { content: string } }>("/api/chat", {
      model,
      messages,
      format: schema,
      stream: false,
      think: false,
      keep_alive: "10m",
      options: { temperature: 0.2, num_ctx: 4096 },
    });
    try {
      return JSON.parse(r.message.content) as T;
    } catch {
      throw new OllamaError("모델 답이 JSON 형식이 아닙니다.", "error");
    }
  }
}

/** 모델 이름 비교: "bge-m3" 와 "bge-m3:latest" 는 같다 */
export const hasModel = (list: string[], name: string) => list.some((m) => m === name || m === `${name}:latest` || m.split(":")[0] === name);
