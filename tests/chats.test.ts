import { strToU8, zipSync } from "fflate";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { importConversations, parseExport } from "@/server/connectors/chats/import";
import { items, sources } from "@/server/db/schema";
import { claudeCodeSession } from "@/server/extract";
import { redactSecrets } from "@/server/extract/redact";
import { search } from "@/server/search/query";
import { runScan } from "@/server/sync/scanner";
import { addSource, deps, testDb, tmpDir, write } from "./helpers";

const jl = (...objs: object[]) => objs.map((o) => JSON.stringify(o)).join("\n");

describe("비밀 값 가리기", () => {
  it("API 키·토큰·개인 키·KEY=값 을 가린다", () => {
    const s = redactSecrets(
      [
        "키 sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123",
        "github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz",
        "ntn_123456789012345678901234567890abcd",
        "GOOGLE_CLIENT_SECRET=GOCSPX-abcdefghijklmnopqrstuv",
        "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345",
        "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----",
        "일반 문장은 그대로",
      ].join("\n"),
    );
    expect(s).not.toMatch(/sk-ant-api03|github_pat_11|ntn_1234|GOCSPX|abcdefghijklmnopqrstuvwxyz012345|AAAA/);
    expect(s).toMatch("일반 문장은 그대로");
    expect(s).toMatch("GOOGLE_CLIENT_SECRET=[가림]");
  });
});

describe("Claude Code 세션", () => {
  const session = jl(
    { type: "user", isMeta: true, message: { role: "user", content: "<system-reminder>내부</system-reminder>" } },
    { type: "user", message: { role: "user", content: "허브에 Notion 연결해줘. 토큰 ntn_123456789012345678901234567890abcd" } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "thinking", thinking: "생각" }, { type: "text", text: "Notion 연결을 시작합니다." }, { type: "tool_use", name: "Bash", input: { command: "ls" } }] } },
    { type: "user", message: { role: "user", content: [{ type: "tool_result", content: "비밀 출력 결과" }] } },
    { type: "custom-title", customTitle: "Notion 연결 작업" },
  );

  it("대화 글만 모으고(도구 결과·생각·시스템 알림 제외), 제목을 정하고, 비밀을 가린다", () => {
    const x = claudeCodeSession(Buffer.from(session));
    expect(x.title).toBe("Notion 연결 작업");
    expect(x.body).toMatch("나: 허브에 Notion 연결해줘");
    expect(x.body).toMatch("Claude: Notion 연결을 시작합니다.\n[도구: Bash]");
    expect(x.body).not.toMatch(/생각|비밀 출력|내부|ntn_1234/);
  });

  it("Claude Code 형식이 아닌 jsonl 은 내용 없이 저장", () => {
    expect(claudeCodeSession(Buffer.from(jl({ a: 1 }, { b: 2 }))).body).toBe("");
  });

  it("스캔하면 세션 제목으로 검색된다", async () => {
    const db = testDb();
    const root = tmpDir();
    write(root, "-Users-mh-code-my-hub/abc-123.jsonl", session);
    const src = addSource(db, root);
    await runScan(db, src.id, deps());
    const hit = search(db, "Notion 연결").hits[0];
    expect(hit.title).toBe("Notion 연결 작업");
    expect(hit.kind).toBe("chat");
  });
});

describe("claude.ai · ChatGPT 내보내기 가져오기", () => {
  const claudeExport = [
    {
      uuid: "c-1",
      name: "여행 계획",
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-02T00:00:00Z",
      chat_messages: [
        { sender: "human", text: "후쿠오카 일정 짜줘", content: [{ type: "text", text: "후쿠오카 일정 짜줘" }] },
        { sender: "assistant", text: "", content: [{ type: "text", text: "1일차: 하카타" }] },
      ],
    },
  ];
  const gptExport = [
    {
      conversation_id: "g-1",
      title: "파이썬 질문",
      create_time: 1790000000,
      update_time: 1790000100,
      current_node: "n3",
      mapping: {
        n0: { parent: null, message: null },
        n1: { parent: "n0", message: { author: { role: "user" }, content: { parts: ["리스트 정렬 방법?"] } } },
        nx: { parent: "n1", message: { author: { role: "assistant" }, content: { parts: ["버려진 답"] } } },
        n2: { parent: "n1", message: { author: { role: "assistant" }, content: { parts: ["sorted() 를 쓰세요"] } } },
        n3: { parent: "n2", message: { author: { role: "system" }, content: { parts: ["숨김"] } } },
      },
    },
  ];

  it("claude.ai zip 을 읽어 대화를 가져오고, 다시 가져오면 바뀐 것만 갱신한다", () => {
    const db = testDb();
    const zip = Buffer.from(zipSync({ "conversations.json": strToU8(JSON.stringify(claudeExport)), "users.json": strToU8("[]") }));
    const p = parseExport(zip, "data.zip");
    expect(p.provider).toBe("claude.ai");
    let r = importConversations(db, p.provider, p.conversations);
    expect(r.added).toBe(1);
    const it = db.select().from(items).where(eq(items.externalId, "c-1")).get()!;
    expect(it.url).toBe("https://claude.ai/chat/c-1");
    expect(search(db, "하카타").hits[0].title).toBe("여행 계획");
    expect(db.select().from(sources).where(eq(sources.id, it.sourceId)).get()!.config).toMatchObject({ externalAi: "deny" });
    r = importConversations(db, p.provider, p.conversations);
    expect(r).toMatchObject({ added: 0, updated: 0, skipped: 1 });
  });

  it("ChatGPT: 현재 보이는 가지만 따라가고 시스템 메시지는 뺀다", () => {
    const db = testDb();
    const p = parseExport(Buffer.from(JSON.stringify(gptExport)), "conversations.json");
    expect(p.provider).toBe("chatgpt");
    expect(p.conversations[0].messages.map((m) => m.text)).toEqual(["리스트 정렬 방법?", "sorted() 를 쓰세요"]);
    importConversations(db, p.provider, p.conversations);
    expect(search(db, "sorted").hits[0].title).toBe("파이썬 질문");
    expect(search(db, "버려진").hits).toHaveLength(0);
  });

  it("알 수 없는 형식은 거절한다", () => {
    expect(() => parseExport(Buffer.from(JSON.stringify([{ foo: 1 }])), "x.json")).toThrow();
  });
});
