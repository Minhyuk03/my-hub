import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { normId, NotionClient, type NBlock } from "@/server/connectors/notion/client";
import { notionRoot, runNotionChanges, runNotionScan } from "@/server/connectors/notion/sync";
import { cloudPathLabel } from "@/server/connectors/common";
import { folders, items, sources } from "@/server/db/schema";
import { createProject, linkFolder, projectItemList } from "@/server/projects";
import { search } from "@/server/search/query";
import { testDb } from "./helpers";

const ROOT = "3e3533f6b13580518794cd78560ee63c";
const dash = (id: string) => `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
let n = 0;
const nid = () => (++n).toString(16).padStart(32, "a");
const rt = (t: string) => [{ plain_text: t }];

/** 가짜 Notion API */
class FakeNotion {
  pages = new Map<string, { title: string; parent: { type: string; [k: string]: string }; edited: string; archived?: boolean; blocks: NBlock[]; props?: Record<string, unknown>; isDb?: boolean }>();
  blocks = new Map<string, { parent: string; children: NBlock[] }>();
  token = "secret";
  rateLimitOnce = 0;
  blockCalls: string[] = [];
  private clock = Date.UTC(2026, 9, 1);
  tick() {
    this.clock += 60_000;
    return new Date(this.clock).toISOString();
  }
  page(title: string, parent: string | { block: string } | { db: string }, blocks: NBlock[] = [], props?: Record<string, unknown>) {
    const id = nid();
    const p: { type: string; [k: string]: string } = typeof parent === "string" ? { type: "page_id", page_id: dash(parent) } : "block" in parent ? { type: "block_id", block_id: dash(parent.block) } : { type: "database_id", database_id: dash(parent.db) };
    this.pages.set(id, { title, parent: p, edited: this.tick(), blocks, props });
    return id;
  }
  db(title: string, parent: string) {
    const id = nid();
    this.pages.set(id, { title, parent: { type: "page_id", page_id: dash(parent) }, edited: this.tick(), blocks: [], isDb: true });
    return id;
  }
  edit(id: string, patch: Partial<{ title: string; blocks: NBlock[]; archived: boolean }>) {
    Object.assign(this.pages.get(id)!, patch, { edited: this.tick() });
  }
  obj(id: string) {
    const p = this.pages.get(id)!;
    if (p.isDb) return { object: "database", id: dash(id), url: `https://www.notion.so/${id}`, last_edited_time: p.edited, parent: p.parent, title: rt(p.title), archived: !!p.archived };
    return {
      object: "page",
      id: dash(id),
      url: `https://www.notion.so/${id}`,
      created_time: p.edited,
      last_edited_time: p.edited,
      archived: !!p.archived,
      parent: p.parent,
      properties: { 이름: { type: "title", title: rt(p.title) }, ...(p.props ?? {}) },
    };
  }
  fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input));
    const auth = new Headers(init?.headers).get("authorization");
    if (auth !== `Bearer ${this.token}`) return Response.json({ code: "unauthorized" }, { status: 401 });
    if (this.rateLimitOnce > 0) {
      this.rateLimitOnce--;
      return new Response("{}", { status: 429, headers: { "Retry-After": "1" } });
    }
    const p = u.pathname.replace("/v1", "");
    if (p === "/search") {
      const body = JSON.parse(String(init?.body));
      const wantDb = body.filter.value === "database";
      const all = [...this.pages.entries()]
        .filter(([, v]) => !!v.isDb === wantDb && !v.archived)
        .sort((a, b) => b[1].edited.localeCompare(a[1].edited))
        .map(([id]) => this.obj(id));
      const start = Number(body.start_cursor ?? 0);
      return Response.json({ results: all.slice(start, start + 3), has_more: start + 3 < all.length, next_cursor: start + 3 < all.length ? String(start + 3) : null });
    }
    let m = p.match(/^\/(pages|databases)\/([^/]+)$/);
    if (m) {
      const id = normId(m[2])!;
      return this.pages.has(id) ? Response.json(this.obj(id)) : Response.json({ code: "object_not_found" }, { status: 404 });
    }
    m = p.match(/^\/blocks\/([^/]+)\/children$/);
    if (m) {
      const id = normId(m[1])!;
      this.blockCalls.push(id);
      const list = this.pages.get(id)?.blocks ?? this.blocks.get(id)?.children ?? [];
      return Response.json({ results: list, has_more: false, next_cursor: null });
    }
    m = p.match(/^\/blocks\/([^/]+)$/);
    if (m) {
      const b = this.blocks.get(normId(m[1])!);
      return b ? Response.json({ id: m[1], type: "column", has_children: true, parent: { type: "page_id", page_id: dash(b.parent) } }) : Response.json({}, { status: 404 });
    }
    return Response.json({}, { status: 400 });
  }) as typeof fetch;
}

const para = (t: string): NBlock => ({ id: nid(), type: "paragraph", has_children: false, paragraph: { rich_text: rt(t) } });
const h1 = (t: string): NBlock => ({ id: nid(), type: "heading_1", has_children: false, heading_1: { rich_text: rt(t) } });

function setup() {
  const db = testDb();
  const fake = new FakeNotion();
  fake.pages.set(ROOT, { title: "나의 기록", parent: { type: "workspace", workspace: "true" }, edited: fake.tick(), blocks: [h1("기록 모음")] });
  const client = new NotionClient({ fetch: fake.fetch, token: "secret", sleep: async () => {}, minIntervalMs: 0 });
  const src = db.insert(sources).values({ kind: "notion", name: "나의 기록 (Notion)", rootPath: notionRoot(ROOT), config: { rootId: ROOT }, createdAt: Date.now() }).returning().get();
  return { db, fake, client, src, d: { client, now: () => Date.now() } };
}
const titles = (db: ReturnType<typeof testDb>) =>
  db
    .select()
    .from(items)
    .all()
    .filter((i) => i.state !== "deleted")
    .map((i) => i.title)
    .sort();

describe("Notion 연결 (Phase 3b)", () => {
  it("루트 아래 페이지·하위 페이지·데이터베이스 행을 가져오고, 본문·속성·태그를 색인한다", async () => {
    const { db, fake, src, d } = setup();
    const toggleId = nid();
    const blog = fake.page("블로그 리뉴얼", ROOT, [
      h1("목표"),
      { id: nid(), type: "bulleted_list_item", has_children: false, bulleted_list_item: { rich_text: rt("검색 개선") } },
      { id: toggleId, type: "toggle", has_children: true, toggle: { rich_text: rt("세부") } },
    ]);
    fake.blocks.set(toggleId, { parent: blog, children: [para("토글 안 내용")] });
    fake.page("회의록", blog, [para("주간 회의 내용")]);
    const dbId = fake.db("독서 목록", ROOT);
    fake.page("데미안", { db: dbId }, [para("감상")], { 태그: { type: "multi_select", multi_select: [{ name: "소설" }, { name: "고전" }] }, 저자: { type: "rich_text", rich_text: rt("헤세") } });
    const col = nid();
    fake.blocks.set(col, { parent: blog, children: [] });
    fake.page("열 안의 페이지", { block: col }, [para("열 내용")]);
    fake.pages.set(nid(), { title: "다른 워크스페이스 페이지", parent: { type: "workspace", workspace: "true" }, edited: fake.tick(), blocks: [] });

    const r = await runNotionScan(db, src.id, d);
    expect(r.result).toBe("ok");
    expect(titles(db)).toEqual(["나의 기록", "데미안", "블로그 리뉴얼", "열 안의 페이지", "회의록"]);
    expect(search(db, "토글").hits[0].title).toBe("블로그 리뉴얼");
    expect(search(db, "헤세").hits[0].title).toBe("데미안");
    expect(search(db, "감상", { tag: "소설" }).hits).toHaveLength(1);
    const meeting = db.select().from(items).where(eq(items.title, "회의록")).get()!;
    expect(cloudPathLabel(meeting.path)).toBe("Notion/블로그 리뉴얼/회의록");
    expect(meeting.url).toMatch(/^https:\/\/www\.notion\.so\//);
    expect(cloudPathLabel(db.select().from(items).where(eq(items.title, "열 안의 페이지")).get()!.path)).toBe("Notion/블로그 리뉴얼/열 안의 페이지");
  });

  it("다시 확인할 때 바뀌지 않은 페이지는 본문을 다시 받지 않는다", async () => {
    const { db, fake, src, d } = setup();
    fake.page("A", ROOT, [para("a")]);
    await runNotionScan(db, src.id, d);
    fake.blockCalls = [];
    await runNotionScan(db, src.id, d);
    expect(fake.blockCalls).toHaveLength(0);
  });

  it("변경 반영: 수정·새 페이지·이름 변경 (프로젝트 연결 유지, 페이지 자신과 하위 페이지 포함)", async () => {
    const { db, fake, src, d } = setup();
    const blog = fake.page("블로그", ROOT, [para("처음")]);
    await runNotionScan(db, src.id, d);
    const p = createProject(db, "블로그 리뉴얼");
    linkFolder(db, p.id, db.select().from(folders).where(eq(folders.externalId, blog)).get()!.id);
    expect(projectItemList(db, p.id).items.map((i) => i.title)).toEqual(["블로그"]);

    fake.edit(blog, { title: "블로그 2026", blocks: [para("수정된 본문")] });
    fake.page("새 하위 페이지", blog, [para("새로 씀")]);
    const r = await runNotionChanges(db, src.id, d);
    expect(r.result).toBe("ok");
    expect(search(db, "수정된").hits[0].title).toBe("블로그 2026");
    expect(projectItemList(db, p.id).items.map((i) => i.title).sort()).toEqual(["블로그 2026", "새 하위 페이지"]);
  });

  it("보관·삭제한 페이지는 전체 확인이 끝났을 때만 deleted 로 표시한다", async () => {
    const { db, fake, src, d } = setup();
    const a = fake.page("지울 페이지", ROOT, [para("x")]);
    await runNotionScan(db, src.id, d);
    fake.edit(a, { archived: true });
    await runNotionChanges(db, src.id, d);
    expect(titles(db)).toContain("지울 페이지");
    await runNotionScan(db, src.id, d);
    expect(titles(db)).not.toContain("지울 페이지");
  });

  it("토큰이 틀리거나 루트 페이지가 공유되지 않았으면 오프라인으로 표시하고 지우지 않는다", async () => {
    const { db, fake, src, d } = setup();
    fake.page("A", ROOT, [para("a")]);
    await runNotionScan(db, src.id, d);
    fake.token = "other";
    let r = await runNotionScan(db, src.id, d);
    expect(r.result).toBe("offline");
    expect(r.message).toMatch("토큰");
    fake.token = "secret";
    fake.pages.delete(ROOT);
    r = await runNotionScan(db, src.id, d);
    expect(r.result).toBe("offline");
    expect(r.message).toMatch("공유");
    expect(titles(db)).toEqual(["A", "나의 기록"]);
  });

  it("요청 제한(429)은 기다렸다 다시 시도한다", async () => {
    const { db, fake, src, d } = setup();
    fake.page("A", ROOT, [para("a")]);
    fake.rateLimitOnce = 2;
    expect((await runNotionScan(db, src.id, d)).result).toBe("ok");
  });

  it("주소·대시 형식의 ID 를 정리한다", () => {
    expect(normId("https://app.notion.com/p/4-3e3533f6b13580518794cd78560ee63c")).toBe(ROOT);
    expect(normId(dash(ROOT))).toBe(ROOT);
    expect(normId("abc")).toBeNull();
  });
});
