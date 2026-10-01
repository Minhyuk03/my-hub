import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { FigmaClient, parseFigmaTarget, type FgFile, type FgNode } from "@/server/connectors/figma/client";
import { figmaRoot, runFigmaScan } from "@/server/connectors/figma/sync";
import { cloudPathLabel } from "@/server/connectors/common";
import { folders, items, sources } from "@/server/db/schema";
import { createProject, linkFolder, projectItemList } from "@/server/projects";
import { search } from "@/server/search/query";
import { testDb } from "./helpers";

/** 가짜 Figma API */
class FakeFigma {
  token = "tok";
  projects = new Map<string, { name: string; files: FgFile[] }>();
  docs = new Map<string, FgNode>();
  fileCalls = 0;
  rateLimitFile = false;
  fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (new Headers(init?.headers).get("x-figma-token") !== this.token) return new Response("{}", { status: 403 });
    const p = new URL(String(input)).pathname.replace("/v1", "");
    if (p === "/me") return Response.json({ handle: "민혁" });
    let m = p.match(/^\/teams\/(\d+)\/projects$/);
    if (m) return Response.json({ name: "내 팀", projects: [...this.projects.entries()].map(([id, v]) => ({ id: Number(id), name: v.name })) });
    m = p.match(/^\/projects\/(\d+)\/files$/);
    if (m) return this.projects.has(m[1]) ? Response.json(this.projects.get(m[1])) : new Response("{}", { status: 404 });
    m = p.match(/^\/files\/([^/]+)$/);
    if (m) {
      this.fileCalls++;
      if (this.rateLimitFile) return new Response("{}", { status: 429, headers: { "retry-after": "3600" } });
      return Response.json({ name: "", lastModified: "", document: this.docs.get(m[1]) });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}

const doc = (page: string, frame: string, text: string): FgNode => ({
  id: "0",
  name: "Document",
  type: "DOCUMENT",
  children: [{ id: "1", name: page, type: "CANVAS", children: [{ id: "2", name: frame, type: "FRAME", children: [{ id: "3", name: "t", type: "TEXT", characters: text }] }] }],
});

function setup(cfg: Record<string, unknown> = {}) {
  const db = testDb();
  const fake = new FakeFigma();
  fake.projects.set("11", { name: "블로그 리뉴얼", files: [{ key: "K1", name: "메인 화면", last_modified: "2026-09-30T00:00:00Z", thumbnail_url: "https://s3/thumb1.png" }] });
  fake.projects.set("12", { name: "허브", files: [{ key: "K2", name: "대시보드", last_modified: "2026-09-29T00:00:00Z" }] });
  fake.docs.set("K1", doc("홈", "히어로 섹션", "지금 시작하기"));
  const client = new FigmaClient({ fetch: fake.fetch, token: "tok", sleep: async () => {} });
  const src = db
    .insert(sources)
    .values({ kind: "figma", name: "내 팀 (Figma)", rootPath: figmaRoot("team", "99"), config: { target: "team", id: "99", ...cfg }, createdAt: Date.now() })
    .returning()
    .get();
  return { db, fake, src, d: { client, now: () => Date.UTC(2026, 9, 1) } };
}
const titles = (db: ReturnType<typeof testDb>) =>
  db
    .select()
    .from(items)
    .all()
    .filter((i) => i.state !== "deleted")
    .map((i) => i.title)
    .sort();

describe("Figma 연결 (Phase 3d)", () => {
  it("팀의 프로젝트·파일 목록을 가져온다. 기본은 내용을 받지 않는다(요청 한도 절약)", async () => {
    const { db, fake, src, d } = setup();
    const r = await runFigmaScan(db, src.id, d);
    expect(r.result).toBe("ok");
    expect(titles(db)).toEqual(["대시보드", "메인 화면"]);
    expect(fake.fileCalls).toBe(0);
    const f = db.select().from(items).where(eq(items.title, "메인 화면")).get()!;
    expect(cloudPathLabel(f.path)).toBe("Figma/블로그 리뉴얼/메인 화면");
    expect(f.url).toBe("https://www.figma.com/design/K1");
    expect(f.kind).toBe("design");
    expect(search(db, "메인").hits).toHaveLength(1);
  });

  it("'본문 텍스트'를 켜면 페이지·프레임 이름과 글자를 색인하고, 하루 상한을 지킨다", async () => {
    const { db, fake, src, d } = setup({ fetchText: true, dailyTextLimit: 1 });
    await runFigmaScan(db, src.id, d);
    expect(fake.fileCalls).toBe(1);
    expect(search(db, "히어로").hits[0].title).toBe("메인 화면");
    // 바뀌지 않았으면 다시 받지 않는다
    await runFigmaScan(db, src.id, d);
    expect(fake.fileCalls).toBe(1);
  });

  it("내용 요청이 한도에 걸려도 목록은 저장하고, 다음에 다시 시도한다", async () => {
    const { db, fake, src, d } = setup({ fetchText: true, dailyTextLimit: 5 });
    fake.rateLimitFile = true;
    expect((await runFigmaScan(db, src.id, d)).result).toBe("ok");
    expect(titles(db)).toEqual(["대시보드", "메인 화면"]);
    fake.rateLimitFile = false;
    await runFigmaScan(db, src.id, d);
    expect(search(db, "히어로").hits).toHaveLength(1);
  });

  it("프로젝트를 다른 소스와 같은 프로젝트로 묶을 수 있고, 지운 파일은 전체 확인 때 deleted", async () => {
    const { db, fake, src, d } = setup();
    await runFigmaScan(db, src.id, d);
    const p = createProject(db, "블로그 리뉴얼");
    linkFolder(db, p.id, db.select().from(folders).where(eq(folders.externalId, "p11")).get()!.id);
    expect(projectItemList(db, p.id).items.map((i) => i.title)).toEqual(["메인 화면"]);
    fake.projects.get("11")!.files = [];
    await runFigmaScan(db, src.id, d);
    expect(titles(db)).toEqual(["대시보드"]);
  });

  it("토큰 오류는 오프라인, 아무것도 지우지 않는다", async () => {
    const { db, fake, src, d } = setup();
    await runFigmaScan(db, src.id, d);
    fake.token = "other";
    const r = await runFigmaScan(db, src.id, d);
    expect(r.result).toBe("offline");
    expect(titles(db)).toEqual(["대시보드", "메인 화면"]);
  });

  it("주소 해석", () => {
    expect(parseFigmaTarget("https://www.figma.com/files/team/1234567/all-projects")).toEqual({ kind: "team", id: "1234567" });
    expect(parseFigmaTarget("https://www.figma.com/files/project/777/Hub")).toEqual({ kind: "project", id: "777" });
    expect(parseFigmaTarget("https://www.figma.com/design/abc")).toBeNull();
  });
});
