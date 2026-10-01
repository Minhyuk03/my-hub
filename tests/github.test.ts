import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { GitHubClient, type GhIssue, type GhRepo } from "@/server/connectors/github/client";
import { githubRoot, runGitHubChanges, runGitHubScan } from "@/server/connectors/github/sync";
import { cloudPathLabel } from "@/server/connectors/common";
import { folders, items, sources } from "@/server/db/schema";
import { createProject, linkFolder, projectItemList } from "@/server/projects";
import { search } from "@/server/search/query";
import { testDb } from "./helpers";

/** 가짜 GitHub API */
class FakeGitHub {
  login = "Minhyuk03";
  token = "tok";
  repos: GhRepo[] = [];
  readmes = new Map<string, string>();
  issues = new Map<string, GhIssue[]>();
  rateLimitOnce = false;
  readmeCalls = 0;
  private id = 100;
  private t = Date.UTC(2026, 9, 1);
  now() {
    this.t += 60_000;
    return new Date(this.t).toISOString();
  }
  repo(name: string, extra: Partial<GhRepo> = {}) {
    const r: GhRepo = {
      id: ++this.id,
      name,
      full_name: `${this.login}/${name}`,
      html_url: `https://github.com/${this.login}/${name}`,
      description: `${name} 설명`,
      fork: false,
      archived: false,
      private: false,
      language: "TypeScript",
      topics: [],
      default_branch: "main",
      created_at: this.now(),
      updated_at: this.now(),
      pushed_at: this.now(),
      owner: { login: this.login },
      ...extra,
    };
    this.repos.push(r);
    return r;
  }
  issue(repo: GhRepo, title: string, body = "", pr = false) {
    const i: GhIssue = { id: ++this.id, number: (this.issues.get(repo.name)?.length ?? 0) + 1, title, body, state: "open", html_url: `${repo.html_url}/issues/1`, labels: [{ name: "bug" }], created_at: this.now(), updated_at: this.now(), ...(pr ? { pull_request: {} } : {}) };
    this.issues.set(repo.name, [...(this.issues.get(repo.name) ?? []), i]);
    return i;
  }
  touch(r: GhRepo) {
    r.pushed_at = this.now();
    r.updated_at = r.pushed_at;
  }
  fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input));
    if (new Headers(init?.headers).get("authorization") !== `Bearer ${this.token}`) return new Response("{}", { status: 401 });
    if (this.rateLimitOnce) {
      this.rateLimitOnce = false;
      return new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 1) } });
    }
    const p = u.pathname;
    if (p === "/user") return Response.json({ login: this.login, name: "민혁" });
    if (p === "/user/repos") {
      const page = Number(u.searchParams.get("page") ?? 1);
      const list = [...this.repos].sort((a, b) => (b.pushed_at ?? "").localeCompare(a.pushed_at ?? ""));
      const slice = list.slice((page - 1) * 2, page * 2);
      const headers = page * 2 < list.length ? { link: `<https://api.github.com/user/repos?per_page=100&page=${page + 1}>; rel="next"` } : undefined;
      return Response.json(slice, { headers });
    }
    const m = p.match(/^\/repos\/[^/]+\/([^/]+)\/(readme|commits|issues)$/);
    if (m) {
      const [, name, what] = m;
      if (what === "readme") {
        this.readmeCalls++;
        return this.readmes.has(name) ? new Response(this.readmes.get(name)) : new Response("{}", { status: 404 });
      }
      if (what === "commits") return Response.json([{ sha: "a", html_url: "", commit: { message: "첫 커밋\n\n본문", author: { name: "m", date: "2026-09-30T00:00:00Z" } } }]);
      const since = u.searchParams.get("since");
      return Response.json((this.issues.get(name) ?? []).filter((i) => !since || i.updated_at >= since));
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}

function setup() {
  const db = testDb();
  const fake = new FakeGitHub();
  const client = new GitHubClient({ fetch: fake.fetch, token: "tok", sleep: async () => {} });
  const src = db.insert(sources).values({ kind: "github", name: "Minhyuk03 (GitHub)", rootPath: githubRoot("Minhyuk03"), config: { login: "Minhyuk03" }, createdAt: Date.now() }).returning().get();
  return { db, fake, client, src, d: { client, now: () => Date.parse(fake.now()) } };
}
const titles = (db: ReturnType<typeof testDb>) =>
  db
    .select()
    .from(items)
    .all()
    .filter((i) => i.state !== "deleted")
    .map((i) => i.title)
    .sort();

describe("GitHub 연결 (Phase 3c)", () => {
  it("내 저장소(포크 제외)의 README·설명·주제·최근 커밋과 이슈·PR 을 가져온다 (여러 페이지)", async () => {
    const { db, fake, src, d } = setup();
    const hub = fake.repo("my-hub", { topics: ["nextjs", "sqlite"], private: true });
    fake.readmes.set("my-hub", "# 나의 허브\n흩어진 파일을 한곳에서 검색");
    fake.repo("blog");
    fake.repo("forked-lib", { fork: true });
    fake.issue(hub, "검색이 느림", "한글 검색 개선 필요");
    fake.issue(hub, "Drive 연결", "", true);
    const r = await runGitHubScan(db, src.id, d);
    expect(r.result).toBe("ok");
    expect(titles(db)).toEqual(["PR #2 Drive 연결", "blog", "my-hub", "이슈 #1 검색이 느림"]);
    expect(search(db, "흩어진").hits[0].title).toBe("my-hub");
    expect(search(db, "첫 커밋").hits).toHaveLength(2); // 두 저장소의 최근 커밋
    expect(search(db, "허브", { tag: "nextjs" }).hits).toHaveLength(1);
    const issue = db.select().from(items).where(eq(items.title, "이슈 #1 검색이 느림")).get()!;
    expect(cloudPathLabel(issue.path)).toBe("GitHub/my-hub/이슈 ＃1 검색이 느림");
    expect(issue.url).toMatch(/^https:\/\/github\.com\//);
  });

  it("바뀌지 않은 저장소는 README 를 다시 받지 않는다", async () => {
    const { db, fake, src, d } = setup();
    fake.repo("a");
    await runGitHubScan(db, src.id, d);
    const before = fake.readmeCalls;
    await runGitHubScan(db, src.id, d);
    expect(fake.readmeCalls).toBe(before);
  });

  it("변경 반영: push 된 저장소·새 이슈·이름 변경(같은 항목·프로젝트 연결 유지, 저장소+이슈 함께)", async () => {
    const { db, fake, src, d } = setup();
    const hub = fake.repo("my-hub");
    fake.readmes.set("my-hub", "처음");
    await runGitHubScan(db, src.id, d);
    const p = createProject(db, "허브");
    linkFolder(db, p.id, db.select().from(folders).where(eq(folders.externalId, `r${hub.id}`)).get()!.id);

    fake.readmes.set("my-hub", "바뀐 README");
    hub.name = "hub";
    hub.full_name = "Minhyuk03/hub";
    fake.readmes.set("hub", "바뀐 README");
    fake.touch(hub);
    fake.issues.set("hub", []);
    fake.issue(hub, "새 이슈", "새로 올림");
    const r = await runGitHubChanges(db, src.id, d);
    expect(r.result).toBe("ok");
    expect(search(db, "바뀐").hits[0].title).toBe("hub");
    expect(projectItemList(db, p.id).items.map((i) => i.title).sort()).toEqual(["hub", "이슈 #1 새 이슈"]);
  });

  it("지운 저장소는 전체 확인이 끝났을 때만 deleted", async () => {
    const { db, fake, src, d } = setup();
    fake.repo("a");
    fake.repo("b");
    await runGitHubScan(db, src.id, d);
    fake.repos = fake.repos.filter((r) => r.name !== "b");
    await runGitHubChanges(db, src.id, d);
    expect(titles(db)).toContain("b");
    await runGitHubScan(db, src.id, d);
    expect(titles(db)).toEqual(["a"]);
  });

  it("토큰 오류는 오프라인으로 표시하고 지우지 않는다. 요청 한도는 초기화까지 기다린다", async () => {
    const { db, fake, src, d } = setup();
    fake.repo("a");
    fake.rateLimitOnce = true;
    expect((await runGitHubScan(db, src.id, d)).result).toBe("ok");
    fake.token = "other";
    const r = await runGitHubScan(db, src.id, d);
    expect(r.result).toBe("offline");
    expect(r.message).toMatch("토큰");
    expect(titles(db)).toEqual(["a"]);
  });
});
