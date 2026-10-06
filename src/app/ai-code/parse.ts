/**
 * AI 코드 출력(Codex `exec --json`, Claude `stream-json`)을 사람이 읽는 블록으로 바꾼다.
 * - 답변은 말풍선, 파일 수정은 한 줄 요약, 진짜 오류만 빨간색. 일부러 꺼 둔 도구에 대한 안내는 숨긴다.
 * - 검사(테스트·타입·코드 검사) 출력은 색 코드만 지운 일반 글로 보여 준다.
 * - 아직 끝나지 않은 마지막 줄(JSON 이 덜 온 것)은 건너뛴다. 원본은 화면의 "원본 기록 보기"에서 그대로 볼 수 있다.
 */
export type Block =
  | { kind: "answer"; text: string; streaming?: boolean }
  | { kind: "file"; action: "add" | "update" | "delete"; path: string }
  | { kind: "tool"; text: string }
  | { kind: "error"; text: string }
  | { kind: "info"; text: string }
  | { kind: "text"; text: string };

/** 터미널 색 코드 지우기 */
export const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");

/** 안전을 위해 일부러 꺼 둔 기능에 대한 안내 (오류가 아님) */
const DISABLED_NOTICE = /unavailable because .* (is )?disabled|feature .* is disabled|code[_ -]?mode/i;

type J = Record<string, unknown> & { type?: string };
const str = (v: unknown) => (typeof v === "string" ? v : "");

function shortPath(p: string, root?: string) {
  if (root && p.startsWith(root + "/")) return p.slice(root.length + 1);
  return p.replace(/^\/Users\/[^/]+\//, "~/");
}

function lines(output: string, running: boolean): { json: J | null; raw: string }[] {
  const ls = output.split("\n");
  // 실행 중이면 마지막 줄은 아직 덜 왔을 수 있다
  if (running && !output.endsWith("\n")) ls.pop();
  return ls
    .filter((l) => l.trim())
    .map((raw) => {
      const t = raw.trim();
      if (!t.startsWith("{")) return { json: null, raw };
      try {
        return { json: JSON.parse(t) as J, raw };
      } catch {
        return { json: null, raw };
      }
    });
}

/** JSON 이 아닌 줄: 표준 오류는 빨간색, 나머지는 글 */
function plain(raw: string): Block | null {
  const t = stripAnsi(raw).replace(/\s+$/, "");
  if (!t.trim()) return null;
  if (t.startsWith("[stderr]")) {
    const msg = t.slice(8).trim();
    return msg && !DISABLED_NOTICE.test(msg) ? { kind: "error", text: msg } : null;
  }
  if (t.startsWith("[출력 제한 초과")) return { kind: "error", text: t.replace(/^\[|\]$/g, "") };
  return { kind: "text", text: t };
}

function codex(output: string, running: boolean, root?: string): Block[] {
  const out: Block[] = [];
  const answers = new Map<string, number>(); // item id → out 위치 (같은 답변이 updated/completed 로 여러 번 옴)
  for (const { json, raw } of lines(output, running)) {
    if (!json) {
      const b = plain(raw);
      if (b) out.push(b);
      continue;
    }
    const item = (json.item ?? {}) as J & { id?: string };
    switch (json.type) {
      case "item.started":
      case "item.updated":
      case "item.completed": {
        if (item.type === "agent_message") {
          const block: Block = { kind: "answer", text: str(item.text), streaming: json.type !== "item.completed" };
          const at = item.id ? answers.get(item.id) : undefined;
          if (at !== undefined) out[at] = block;
          else {
            if (item.id) answers.set(item.id, out.length);
            out.push(block);
          }
        } else if (item.type === "file_change" && json.type === "item.completed") {
          for (const ch of (item.changes as { path?: string; kind?: string }[] | undefined) ?? [])
            out.push({ kind: "file", action: ch.kind === "add" ? "add" : ch.kind === "delete" ? "delete" : "update", path: shortPath(str(ch.path), root) });
        } else if (item.type === "command_execution" && json.type === "item.completed") {
          out.push({ kind: "tool", text: `명령 실행: ${str(item.command)}${typeof item.exit_code === "number" ? ` (종료 코드 ${item.exit_code})` : ""}` });
        } else if (item.type === "mcp_tool_call" && json.type === "item.completed") {
          out.push({ kind: "tool", text: `도구: ${str(item.server)} ${str(item.tool)}`.trim() });
        } else if (item.type === "web_search" && json.type === "item.completed") {
          out.push({ kind: "tool", text: `웹 검색: ${str(item.query)}` });
        } else if (item.type === "todo_list" && json.type === "item.completed") {
          const items = (item.items as { text?: string; completed?: boolean }[] | undefined) ?? [];
          out.push({ kind: "info", text: items.map((t) => `${t.completed ? "☑" : "☐"} ${str(t.text)}`).join("\n") });
        } else if (item.type === "error") {
          const msg = str(item.message);
          if (!DISABLED_NOTICE.test(msg)) out.push({ kind: "error", text: msg });
        }
        break;
      }
      case "turn.completed": {
        const u = (json.usage ?? {}) as Record<string, number>;
        out.push({ kind: "info", text: `완료 · 토큰 입력 ${(u.input_tokens ?? 0).toLocaleString()} / 출력 ${(u.output_tokens ?? 0).toLocaleString()}` });
        break;
      }
      case "turn.failed":
        out.push({ kind: "error", text: str((json.error as J | undefined)?.message) || "작업이 실패했습니다." });
        break;
      case "error":
        if (!DISABLED_NOTICE.test(str(json.message))) out.push({ kind: "error", text: str(json.message) });
        break;
    }
  }
  return out;
}

function claude(output: string, running: boolean, root?: string): Block[] {
  const out: Block[] = [];
  const msgAt = new Map<string, number>(); // 메시지 id → 스트리밍 중인 답변 위치
  let current = ""; // 지금 스트리밍 중인 메시지 id
  for (const { json, raw } of lines(output, running)) {
    if (!json) {
      const b = plain(raw);
      if (b) out.push(b);
      continue;
    }
    if (json.type === "stream_event") {
      const ev = (json.event ?? {}) as J & { message?: { id?: string }; delta?: { type?: string; text?: string } };
      if (ev.type === "message_start") current = ev.message?.id ?? "";
      if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && current) {
        const at = msgAt.get(current);
        if (at === undefined) {
          msgAt.set(current, out.length);
          out.push({ kind: "answer", text: ev.delta.text ?? "", streaming: true });
        } else {
          const b = out[at] as Extract<Block, { kind: "answer" }>;
          out[at] = { ...b, text: b.text + (ev.delta.text ?? "") };
        }
      }
      continue;
    }
    if (json.type === "assistant") {
      const m = (json.message ?? {}) as { id?: string; content?: { type: string; text?: string; name?: string; input?: Record<string, unknown> }[] };
      const text = (m.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
      const at = m.id ? msgAt.get(m.id) : undefined;
      if (text) {
        if (at !== undefined) out[at] = { kind: "answer", text };
        else out.push({ kind: "answer", text });
        if (m.id) msgAt.set(m.id, at ?? out.length - 1);
      }
      for (const c of m.content ?? []) {
        if (c.type !== "tool_use") continue;
        const p = shortPath(str(c.input?.file_path) || str(c.input?.path), root);
        if (c.name === "Write") out.push({ kind: "file", action: "add", path: p });
        else if (c.name === "Edit" || c.name === "MultiEdit") out.push({ kind: "file", action: "update", path: p });
        else if (c.name === "Read") out.push({ kind: "tool", text: `읽음: ${p}` });
        else if (c.name === "Grep" || c.name === "Glob") out.push({ kind: "tool", text: `찾기: ${str(c.input?.pattern)}${p ? ` (${p})` : ""}` });
        else out.push({ kind: "tool", text: `도구: ${c.name ?? ""}` });
      }
      continue;
    }
    if (json.type === "user") {
      const m = (json.message ?? {}) as { content?: { type: string; is_error?: boolean; content?: unknown }[] };
      for (const c of m.content ?? [])
        if (c.type === "tool_result" && c.is_error) {
          const t = typeof c.content === "string" ? c.content : JSON.stringify(c.content);
          out.push({ kind: "error", text: stripAnsi(t).slice(0, 500) });
        }
      continue;
    }
    if (json.type === "result" || "duration_api_ms" in json) {
      if (json.is_error) out.push({ kind: "error", text: str(json.result) || "작업이 실패했습니다." });
      const sec = typeof json.duration_ms === "number" ? `${Math.round(json.duration_ms / 100) / 10}초` : "";
      out.push({ kind: "info", text: ["완료", sec].filter(Boolean).join(" · ") });
    }
  }
  return out.map((b) => (b.kind === "answer" && !running ? { ...b, streaming: false } : b));
}

/** 검사 출력: 색 코드를 지운 글 하나 */
function check(output: string): Block[] {
  const t = stripAnsi(output).replace(/^\[stderr\] /gm, "").trim();
  return t ? [{ kind: "text", text: t }] : [];
}

export function parseOutput(provider: string, output: string, running = false, root?: string): Block[] {
  if (!output) return [];
  if (provider === "codex") return codex(output, running, root);
  if (provider === "claude") return claude(output, running, root);
  return check(output);
}
