/**
 * Notion API 클라이언트 (내부 통합 토큰, 읽기 전용)
 * - 토큰은 .env.local 의 NOTION_TOKEN. 값은 출력하지 않는다.
 * - Notion 은 초당 평균 3회로 요청을 제한하므로 요청 사이 간격을 두고, 429(Retry-After)·5xx 는 기다렸다 다시 시도한다.
 */
export const NOTION_API = "https://api.notion.com/v1";
export const NOTION_VERSION = process.env.NOTION_VERSION ?? "2022-06-28";

export type RichText = { plain_text: string; href?: string | null };
export type NParent = { type: "page_id" | "database_id" | "workspace" | "block_id"; page_id?: string; database_id?: string; block_id?: string; workspace?: boolean };
export type NPage = {
  object: "page";
  id: string;
  url: string;
  created_time: string;
  last_edited_time: string;
  archived?: boolean;
  in_trash?: boolean;
  parent: NParent;
  properties: Record<string, NProperty>;
};
export type NDatabase = { object: "database"; id: string; url: string; last_edited_time: string; created_time?: string; archived?: boolean; in_trash?: boolean; parent: NParent; title: RichText[] };
export type NProperty = { type: string; title?: RichText[]; rich_text?: RichText[]; multi_select?: { name: string }[]; select?: { name: string } | null; [k: string]: unknown };
export type NBlock = { id: string; type: string; has_children: boolean; [k: string]: unknown };
type List<T> = { results: T[]; has_more: boolean; next_cursor: string | null };

export class NotionAuthError extends Error {}
export class NotionNotFound extends Error {}

/** "3e3533f6-b135-..." / 주소 → 대시 없는 32자 ID */
export function normId(input: string): string | null {
  const m = input.replace(/-/g, "").match(/[0-9a-f]{32}(?=$|[^0-9a-f])/i);
  return m ? m[0].toLowerCase() : null;
}

export type NotionDeps = { fetch: typeof fetch; token: string; sleep?: (ms: number) => Promise<void>; minIntervalMs?: number };

export class NotionClient {
  private last = 0;
  constructor(private d: NotionDeps) {}

  private async req<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    if (!this.d.token) throw new NotionAuthError("NOTION_TOKEN 이 없습니다. .env.local 에 넣어 주세요.");
    const sleep = this.d.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    for (let attempt = 0; ; attempt++) {
      const wait = this.last + (this.d.minIntervalMs ?? 350) - Date.now();
      if (wait > 0) await sleep(wait);
      this.last = Date.now();
      const r = await this.d.fetch(NOTION_API + path, {
        method,
        headers: { Authorization: `Bearer ${this.d.token}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if ((r.status === 429 || r.status >= 500) && attempt < 5) {
        const ra = Number(r.headers.get("retry-after"));
        await sleep(ra > 0 ? ra * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      if (r.status === 401) throw new NotionAuthError("Notion 토큰이 올바르지 않습니다. 통합 토큰을 확인하세요.");
      if (r.status === 404) throw new NotionNotFound("페이지를 찾을 수 없습니다. Notion 에서 이 페이지를 통합에 연결(공유)했는지 확인하세요.");
      if (!r.ok) throw new Error(`Notion API 오류 ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return r.json() as Promise<T>;
    }
  }

  getPage(id: string) {
    return this.req<NPage>("GET", `/pages/${id}`);
  }
  getBlock(id: string) {
    return this.req<NBlock & { parent: NParent }>("GET", `/blocks/${id}`);
  }
  getDatabase(id: string) {
    return this.req<NDatabase>("GET", `/databases/${id}`);
  }
  me() {
    return this.req<{ name?: string; bot?: { workspace_name?: string } }>("GET", "/users/me");
  }

  /** 통합이 접근할 수 있는 페이지·데이터베이스 (최근 수정 순) */
  search(kind: "page" | "database", cursor?: string) {
    return this.req<List<NPage | NDatabase>>("POST", "/search", {
      filter: { property: "object", value: kind },
      sort: { direction: "descending", timestamp: "last_edited_time" },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
  }

  children(blockId: string, cursor?: string) {
    return this.req<List<NBlock>>("GET", `/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`);
  }

  /** 페이지 본문 블록 전체 (하위 블록 포함, 하위 페이지·DB 는 따로 가져오므로 들어가지 않음) */
  async allBlocks(pageId: string, maxBlocks = 3000): Promise<{ block: NBlock; depth: number }[]> {
    const out: { block: NBlock; depth: number }[] = [];
    const walk = async (id: string, depth: number) => {
      let cursor: string | undefined;
      do {
        const page = await this.children(id, cursor);
        for (const b of page.results) {
          if (out.length >= maxBlocks) return;
          out.push({ block: b, depth });
          if (b.has_children && b.type !== "child_page" && b.type !== "child_database" && depth < 8) await walk(b.id, depth + 1);
        }
        cursor = page.has_more ? (page.next_cursor ?? undefined) : undefined;
      } while (cursor);
    };
    await walk(pageId, 0);
    return out;
  }
}

export const plain = (rt?: RichText[]) => (rt ?? []).map((t) => t.plain_text).join("");

export function pageTitle(p: NPage | NDatabase): string {
  if (p.object === "database") return plain(p.title) || "제목 없는 데이터베이스";
  for (const v of Object.values(p.properties ?? {})) if (v.type === "title") return plain(v.title) || "제목 없음";
  return "제목 없음";
}

/** 블록 → 텍스트 줄 */
export function blockText(b: NBlock): string {
  const data = b[b.type] as { rich_text?: RichText[]; caption?: RichText[]; cells?: RichText[][]; url?: string; expression?: string; checked?: boolean; title?: string } | undefined;
  if (!data) return "";
  if (b.type === "table_row") return (data.cells ?? []).map((c) => plain(c)).join(" | ");
  if (b.type === "equation") return data.expression ?? "";
  if (b.type === "bookmark" || b.type === "embed" || b.type === "link_preview") return [data.url, plain(data.caption)].filter(Boolean).join(" ");
  if (b.type === "child_page" || b.type === "child_database") return data.title ?? "";
  const text = plain(data.rich_text);
  const cap = plain(data.caption);
  const prefix =
    b.type === "heading_1" ? "# " : b.type === "heading_2" ? "## " : b.type === "heading_3" ? "### " : b.type === "bulleted_list_item" ? "- " : b.type === "numbered_list_item" ? "1. " : b.type === "to_do" ? (data.checked ? "[x] " : "[ ] ") : b.type === "quote" ? "> " : "";
  return [prefix + text, cap].filter((x) => x.trim()).join(" ");
}

/** 데이터베이스 행의 속성 → "이름: 값" 줄, 태그(multi_select/select) */
export function propertyText(p: NPage): { lines: string[]; tags: string[] } {
  const lines: string[] = [];
  const tags: string[] = [];
  for (const [name, v] of Object.entries(p.properties ?? {})) {
    if (v.type === "title") continue;
    let val = "";
    if (v.type === "rich_text") val = plain(v.rich_text);
    else if (v.type === "multi_select") {
      val = (v.multi_select ?? []).map((o) => o.name).join(", ");
      if (/태그|tag|분류|카테고리|category/i.test(name)) tags.push(...(v.multi_select ?? []).map((o) => o.name));
    } else if (v.type === "select") {
      val = v.select?.name ?? "";
      if (/태그|tag|분류|카테고리|category/i.test(name) && val) tags.push(val);
    } else if (v.type === "status") val = (v.status as { name?: string } | null)?.name ?? "";
    else if (v.type === "url" || v.type === "email" || v.type === "phone_number") val = String(v[v.type] ?? "");
    else if (v.type === "number") val = v.number == null ? "" : String(v.number);
    else if (v.type === "date") val = (v.date as { start?: string } | null)?.start ?? "";
    else if (v.type === "checkbox") val = v.checkbox ? "예" : "";
    if (val) lines.push(`${name}: ${val}`);
  }
  return { lines, tags: tags.map((t) => t.replace(/\s+/g, "").normalize("NFC")).filter(Boolean) };
}
