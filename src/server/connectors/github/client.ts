/**
 * GitHub REST API 클라이언트 (Fine-grained PAT, 읽기 전용)
 * - 토큰은 .env.local 의 GITHUB_TOKEN. 값은 출력하지 않는다.
 * - 한도(시간당 5,000회)를 다 쓰면 초기화 시각까지 기다리고(최대 2분, 그보다 길면 오류), 429·5xx 는 간격을 늘려 다시 시도한다.
 */
export const GITHUB_API = "https://api.github.com";

export type GhRepo = {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  fork: boolean;
  archived: boolean;
  private: boolean;
  language: string | null;
  topics?: string[];
  default_branch: string;
  created_at: string;
  updated_at: string;
  pushed_at: string | null;
  owner: { login: string };
};
export type GhIssue = {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  html_url: string;
  labels: ({ name: string } | string)[];
  created_at: string;
  updated_at: string;
  pull_request?: unknown;
  user?: { login: string };
};
export type GhCommit = { sha: string; html_url: string; commit: { message: string; author: { name: string; date: string } | null } };

export class GitHubAuthError extends Error {}
export class GitHubNotFound extends Error {}

export type GitHubDeps = { fetch: typeof fetch; token: string; sleep?: (ms: number) => Promise<void>; now?: () => number };

export class GitHubClient {
  constructor(private d: GitHubDeps) {}

  /** 요청 + 재시도. raw=true 면 본문을 문자열로 (README) */
  async request(path: string, opts: { raw?: boolean; allow404?: boolean } = {}): Promise<{ data: unknown; next: string | null } | null> {
    if (!this.d.token) throw new GitHubAuthError("GITHUB_TOKEN 이 없습니다. .env.local 에 넣어 주세요.");
    const sleep = this.d.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const url = path.startsWith("http") ? path : GITHUB_API + path;
    for (let attempt = 0; ; attempt++) {
      const r = await this.d.fetch(url, {
        headers: {
          Authorization: `Bearer ${this.d.token}`,
          Accept: opts.raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "my-hub",
        },
      });
      if (r.status === 401) throw new GitHubAuthError("GitHub 토큰이 올바르지 않거나 만료되었습니다. 새 토큰을 만들어 .env.local 에 넣어 주세요.");
      const remaining = r.headers.get("x-ratelimit-remaining");
      if ((r.status === 403 || r.status === 429) && remaining === "0") {
        const reset = Number(r.headers.get("x-ratelimit-reset")) * 1000;
        const wait = reset - (this.d.now ?? Date.now)();
        if (wait > 120_000 || attempt >= 3) throw new Error(`GitHub 요청 한도를 다 썼습니다. ${new Date(reset).toLocaleTimeString("ko-KR")} 이후 다시 시도합니다.`);
        await sleep(Math.max(wait, 1000));
        continue;
      }
      if ((r.status === 429 || r.status >= 500) && attempt < 5) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (r.status === 404 || r.status === 409) {
        // 409: 빈 저장소의 커밋 목록
        if (opts.allow404) return null;
        throw new GitHubNotFound(`GitHub 에서 찾을 수 없습니다: ${path}`);
      }
      if (r.status === 403) throw new GitHubAuthError("GitHub 토큰 권한이 부족합니다. Contents·Issues·Metadata 읽기 권한을 확인하세요.");
      if (!r.ok) throw new Error(`GitHub API 오류 ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const next = r.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
      return { data: opts.raw ? await r.text() : await r.json(), next };
    }
  }

  /** 여러 페이지 받기 (최대 maxPages) */
  async paged<T>(path: string, maxPages = 10): Promise<{ items: T[]; capped: boolean }> {
    const out: T[] = [];
    let url: string | null = path;
    let pages = 0;
    while (url && pages < maxPages) {
      const r = await this.request(url);
      out.push(...((r!.data as T[]) ?? []));
      url = r!.next;
      pages++;
    }
    return { items: out, capped: !!url };
  }

  async me() {
    return (await this.request("/user"))!.data as { login: string; name: string | null };
  }

  /** 내가 소유한 저장소 (비공개 포함) */
  repos() {
    return this.paged<GhRepo>("/user/repos?per_page=100&affiliation=owner&sort=pushed", 20);
  }

  async readme(full: string): Promise<string> {
    const r = await this.request(`/repos/${full}/readme`, { raw: true, allow404: true });
    return r ? String(r.data) : "";
  }

  async commits(full: string, n = 20): Promise<GhCommit[]> {
    const r = await this.request(`/repos/${full}/commits?per_page=${n}`, { allow404: true });
    return r ? (r.data as GhCommit[]) : [];
  }

  /** 이슈·PR (수정 순). since 를 주면 그 뒤로 바뀐 것만 */
  issues(full: string, since?: string, maxPages = 10) {
    return this.paged<GhIssue>(`/repos/${full}/issues?state=all&per_page=100&sort=updated&direction=desc${since ? `&since=${encodeURIComponent(since)}` : ""}`, maxPages);
  }
}
