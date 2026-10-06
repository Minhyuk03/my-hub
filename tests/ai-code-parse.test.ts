import { describe, expect, it } from "vitest";
import { parseOutput, stripAnsi } from "@/app/ai-code/parse";

const codexOut = [
  '{"type":"thread.started","thread_id":"t1"}',
  '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed; enable `features.code_mode_host`."}}',
  '{"type":"turn.started"}',
  '{"type":"item.completed","item":{"id":"item_1","type":"file_change","changes":[{"path":"/Users/me/code/app/src/a.ts","kind":"update"},{"path":"/Users/me/code/app/src/b.ts","kind":"add"}],"status":"completed"}}',
  '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"네"}}',
  '{"type":"turn.completed","usage":{"input_tokens":10245,"output_tokens":42}}',
  "",
].join("\n");

const claudeOut = [
  '{"type":"system","subtype":"init","cwd":"/Users/me/code/app"}',
  '{"type":"stream_event","event":{"type":"message_start","message":{"id":"m1"}}}',
  '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"HUB_CONNEC"}}}',
  '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"TION_OK"}}}',
  '{"type":"assistant","message":{"id":"m1","content":[{"type":"text","text":"HUB_CONNECTION_OK"},{"type":"tool_use","name":"Edit","input":{"file_path":"/Users/me/code/app/src/a.ts"}}]}}',
  '{"type":"user","message":{"content":[{"type":"tool_result","is_error":true,"content":"파일을 찾을 수 없음"}]}}',
  '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"}}',
  '{"type":"result","subtype":"success","is_error":false,"duration_ms":1600,"result":"HUB_CONNECTION_OK"}',
  "",
].join("\n");

describe("AI 코드 출력 읽기 쉽게", () => {
  it("Codex: 답변은 말풍선, 파일 수정은 한 줄, 꺼 둔 기능 안내는 숨김", () => {
    const b = parseOutput("codex", codexOut, false, "/Users/me/code/app");
    expect(b).toEqual([
      { kind: "file", action: "update", path: "src/a.ts" },
      { kind: "file", action: "add", path: "src/b.ts" },
      { kind: "answer", text: "네", streaming: false },
      { kind: "info", text: "완료 · 토큰 입력 10,245 / 출력 42" },
    ]);
  });

  it("Claude: 스트리밍 조각과 완성 메시지를 하나의 답변으로, 도구 오류는 빨간색", () => {
    const b = parseOutput("claude", claudeOut, false, "/Users/me/code/app");
    expect(b.filter((x) => x.kind === "answer")).toEqual([{ kind: "answer", text: "HUB_CONNECTION_OK", streaming: false }]);
    expect(b).toContainEqual({ kind: "file", action: "update", path: "src/a.ts" });
    expect(b).toContainEqual({ kind: "error", text: "파일을 찾을 수 없음" });
    expect(b.at(-1)).toEqual({ kind: "info", text: "완료 · 1.6초" });
  });

  it("실행 중: 덜 온 마지막 줄은 건너뛰고, 스트리밍 중인 답변을 보여 준다", () => {
    const partial = claudeOut.split("\n").slice(0, 4).join("\n") + '\n{"type":"assistant","mess';
    const b = parseOutput("claude", partial, true);
    expect(b).toEqual([{ kind: "answer", text: "HUB_CONNECTION_OK", streaming: true }]);
  });

  it("검사 출력은 색 코드를 지운 글, 표준 오류의 실제 오류는 남긴다", () => {
    expect(parseOutput("check", "\u001b[32m✓\u001b[39m tests/a.test.ts (3 tests)\n")).toEqual([{ kind: "text", text: "✓ tests/a.test.ts (3 tests)" }]);
    expect(parseOutput("codex", "[stderr] Error: login required\n")).toEqual([{ kind: "error", text: "Error: login required" }]);
    expect(stripAnsi("\u001b[1m\u001b[30mRUN\u001b[22m")).toBe("RUN");
  });
});
