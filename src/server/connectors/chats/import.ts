/**
 * AI 대화 기록 가져오기: claude.ai · ChatGPT "데이터 내보내기" 파일(zip 또는 conversations.json)
 * - 대화마다 항목 하나 (제목, "나:"/"Claude:" 형식 본문, 원본 대화 주소).
 * - 다시 가져오면 바뀐 대화만 갱신한다. 내보내기는 그 시점의 사본이라, 새 파일에 없는 대화도 지우지 않는다.
 * - 비밀 값은 가리고, 이 소스는 외부 AI 전송 기본 금지(config.externalAi = "deny").
 */
import { strFromU8, unzipSync } from "fflate";
import { and, eq } from "drizzle-orm";
import type { Db } from "../../db";
import { items, sources } from "../../db/schema";
import { redactSecrets } from "../../extract/redact";
import { writeItemText } from "../../search/index-writer";
import { cloudPathLabel, seg, upsertCloudFolder } from "../common";

export type ChatProvider = "claude.ai" | "chatgpt";
export type Conversation = { id: string; title: string; created: number | null; updated: number | null; messages: { role: "me" | "ai"; text: string }[]; url: string };

const PROVIDER_LABEL: Record<ChatProvider, { name: string; ai: string }> = {
  "claude.ai": { name: "claude.ai 대화", ai: "Claude" },
  chatgpt: { name: "ChatGPT 대화", ai: "ChatGPT" },
};
export const chatRoot = (p: ChatProvider) => `chat:/${p}`;

type ClaudeConv = {
  uuid: string;
  name?: string;
  created_at?: string;
  updated_at?: string;
  chat_messages?: { sender: string; text?: string; content?: { type: string; text?: string }[] }[];
};
type GptConv = {
  id?: string;
  conversation_id?: string;
  title?: string;
  create_time?: number;
  update_time?: number;
  current_node?: string;
  mapping?: Record<string, { parent?: string | null; message?: { author?: { role?: string }; content?: { parts?: unknown[]; text?: string }; metadata?: { is_visually_hidden_from_conversation?: boolean } } | null }>;
};

function fromClaude(list: ClaudeConv[]): Conversation[] {
  return list.map((c) => ({
    id: c.uuid,
    title: (c.name || "").trim(),
    created: c.created_at ? Date.parse(c.created_at) : null,
    updated: c.updated_at ? Date.parse(c.updated_at) : null,
    url: `https://claude.ai/chat/${c.uuid}`,
    messages: (c.chat_messages ?? [])
      .map((m) => ({
        role: (m.sender === "human" ? "me" : "ai") as "me" | "ai",
        text: (m.content?.filter((x) => x.type === "text" && x.text).map((x) => x.text).join("\n") || m.text || "").trim(),
      }))
      .filter((m) => m.text),
  }));
}

function fromChatGpt(list: GptConv[]): Conversation[] {
  return list.map((c) => {
    const id = c.conversation_id ?? c.id ?? "";
    const msgs: { role: "me" | "ai"; text: string }[] = [];
    // 현재 보이는 가지만 따라간다 (current_node → 부모 … → 처음)
    const chain: string[] = [];
    let node = c.current_node;
    const seen = new Set<string>();
    while (node && c.mapping?.[node] && !seen.has(node)) {
      seen.add(node);
      chain.push(node);
      node = c.mapping[node].parent ?? undefined;
    }
    for (const n of chain.reverse()) {
      const m = c.mapping![n].message;
      const role = m?.author?.role;
      if (!m || (role !== "user" && role !== "assistant") || m.metadata?.is_visually_hidden_from_conversation) continue;
      const parts = (m.content?.parts ?? []).filter((p): p is string => typeof p === "string");
      const text = (parts.join("\n") || m.content?.text || "").trim();
      if (text) msgs.push({ role: role === "user" ? "me" : "ai", text });
    }
    return {
      id,
      title: (c.title || "").trim(),
      created: c.create_time ? Math.round(c.create_time * 1000) : null,
      updated: c.update_time ? Math.round(c.update_time * 1000) : null,
      url: `https://chatgpt.com/c/${id}`,
      messages: msgs,
    };
  });
}

/** zip 또는 json 버퍼를 읽어 형식을 알아낸다 */
export function parseExport(buf: Buffer, fileName = ""): { provider: ChatProvider; conversations: Conversation[] } {
  let jsons: unknown[] = [];
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  if (isZip) {
    const files = unzipSync(new Uint8Array(buf), { filter: (f) => /(^|\/)conversations(-\d+)?\.json$/.test(f.name) });
    const names = Object.keys(files).sort();
    if (!names.length) throw new Error("내보내기 파일에 conversations.json 이 없습니다.");
    for (const n of names) jsons.push(JSON.parse(strFromU8(files[n])));
  } else if (/\.json$/i.test(fileName) || buf[0] === 0x5b /* [ */) {
    jsons = [JSON.parse(buf.toString("utf8"))];
  } else throw new Error("zip 또는 conversations.json 파일을 올려 주세요.");
  const all = jsons.flatMap((j) => (Array.isArray(j) ? j : []));
  if (!all.length) return { provider: "claude.ai", conversations: [] };
  const first = all[0] as Record<string, unknown>;
  if ("chat_messages" in first) return { provider: "claude.ai", conversations: fromClaude(all as ClaudeConv[]) };
  if ("mapping" in first) return { provider: "chatgpt", conversations: fromChatGpt(all as GptConv[]) };
  throw new Error("claude.ai 나 ChatGPT 내보내기 형식이 아닙니다.");
}

/** 대화 소스를 찾거나 만든다 */
export function ensureChatSource(db: Db, provider: ChatProvider) {
  const root = chatRoot(provider);
  const ex = db.select().from(sources).where(eq(sources.rootPath, root)).get();
  if (ex) return ex;
  return db
    .insert(sources)
    .values({ kind: "ai", name: PROVIDER_LABEL[provider].name, rootPath: root, config: { externalAi: "deny" }, createdAt: Date.now(), lastFullScanAt: Date.now(), lastFullScanOk: true })
    .returning()
    .get();
}

export function importConversations(db: Db, provider: ChatProvider, conversations: Conversation[], now = Date.now()) {
  const src = ensureChatSource(db, provider);
  const folderId = upsertCloudFolder(db, src, `root:${provider}`, PROVIDER_LABEL[provider].name, src.rootPath, null, null);
  let added = 0;
  let updated = 0;
  let skipped = 0;
  db.transaction(() => {
    for (const c of conversations) {
      if (!c.id || !c.messages.length) {
        skipped++;
        continue;
      }
      const version = String(c.updated ?? c.created ?? 0);
      const existing = db.select().from(items).where(and(eq(items.sourceId, src.id), eq(items.externalId, c.id))).get();
      if (existing && existing.contentHash === version && existing.state !== "deleted") {
        skipped++;
        continue;
      }
      const title = redactSecrets(c.title || c.messages[0].text.split("\n")[0].slice(0, 60) || "제목 없는 대화").normalize("NFC");
      const path = `${src.rootPath}/${seg(title, c.id)}`;
      const body = redactSecrets(c.messages.map((m) => `${m.role === "me" ? "나" : PROVIDER_LABEL[provider].ai}: ${m.text}`).join("\n\n")).slice(0, 300_000);
      const row = {
        sourceId: src.id,
        folderId,
        path,
        externalId: c.id,
        url: c.url,
        title,
        ext: "chat",
        kind: "chat",
        size: body.length,
        contentHash: version,
        fileId: null,
        dev: null,
        state: "ok" as const,
        noContentReason: null,
        createdAt: c.created,
        modifiedAt: c.updated ?? c.created,
        indexedAt: now,
        deletedDetectedAt: null,
        previewText: body.slice(0, 300),
      };
      const saved = existing ? db.update(items).set(row).where(eq(items.id, existing.id)).returning().get() : db.insert(items).values(row).returning().get();
      writeItemText(db, saved.id, { title, path: cloudPathLabel(path), body });
      if (existing) updated++;
      else added++;
    }
  });
  return { sourceId: src.id, added, updated, skipped, total: conversations.length };
}
