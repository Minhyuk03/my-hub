/**
 * Figma REST API 클라이언트 (개인 액세스 토큰, 읽기 전용)
 * - 토큰은 .env.local 의 FIGMA_TOKEN. 값은 출력하지 않는다.
 * - Figma 는 "내 파일 전체 목록" API 가 없어 팀·프로젝트 단위로 가져온다.
 * - 파일 내용(/files/:key)은 요청 한도가 매우 엄격하므로, 목록·메타데이터만 기본으로 쓰고 내용은 선택 사항으로 둔다.
 * - 429 는 Retry-After 만큼 기다린다 (2분보다 길면 오류로 돌려 다음 확인 때 다시 시도).
 */
export const FIGMA_API = "https://api.figma.com/v1";

export type FgProject = { id: string | number; name: string };
export type FgFile = { key: string; name: string; thumbnail_url?: string; last_modified: string };
export type FgNode = { id: string; name: string; type: string; characters?: string; children?: FgNode[] };

export class FigmaAuthError extends Error {}
export class FigmaNotFound extends Error {}
export class FigmaRateLimit extends Error {}

export type FigmaDeps = { fetch: typeof fetch; token: string; sleep?: (ms: number) => Promise<void> };

export class FigmaClient {
  constructor(private d: FigmaDeps) {}

  private async get<T>(path: string): Promise<T> {
    if (!this.d.token) throw new FigmaAuthError("FIGMA_TOKEN 이 없습니다. .env.local 에 넣어 주세요.");
    const sleep = this.d.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    for (let attempt = 0; ; attempt++) {
      const r = await this.d.fetch(FIGMA_API + path, { headers: { "X-Figma-Token": this.d.token } });
      if (r.status === 401 || r.status === 403) {
        const t = await r.text();
        if (/scope|permission|forbidden/i.test(t) && r.status === 403) throw new FigmaAuthError("Figma 토큰 권한이 부족합니다. 파일 내용·프로젝트 읽기 권한을 확인하세요.");
        throw new FigmaAuthError("Figma 토큰이 올바르지 않거나 만료되었습니다.");
      }
      if (r.status === 429) {
        const ra = Number(r.headers.get("retry-after")) || 60;
        if (ra > 120 || attempt >= 3) throw new FigmaRateLimit(`Figma 요청 한도에 걸렸습니다. 약 ${Math.ceil(ra / 60)}분 뒤 다시 시도합니다.`);
        await sleep(ra * 1000);
        continue;
      }
      if (r.status >= 500 && attempt < 4) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (r.status === 404) throw new FigmaNotFound("Figma 에서 찾을 수 없습니다. 팀·프로젝트 주소와 권한을 확인하세요.");
      if (!r.ok) throw new Error(`Figma API 오류 ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return r.json() as Promise<T>;
    }
  }

  me() {
    return this.get<{ handle: string; email?: string }>("/me");
  }
  teamProjects(teamId: string) {
    return this.get<{ name: string; projects: FgProject[] }>(`/teams/${teamId}/projects`);
  }
  projectFiles(projectId: string) {
    return this.get<{ name: string; files: FgFile[] }>(`/projects/${projectId}/files`);
  }
  /** 파일 내용 (요청 한도가 엄격한 API — 선택 사항) */
  file(key: string) {
    return this.get<{ name: string; lastModified: string; document: FgNode }>(`/files/${key}`);
  }
}

/** 팀·프로젝트 주소 해석: https://www.figma.com/files/team/123/… , …/files/project/456/… , "team:123", "project:456" */
export function parseFigmaTarget(input: string): { kind: "team" | "project"; id: string } | null {
  const s = input.trim();
  const m = s.match(/(team|project)[/:](\d+)/i);
  return m ? { kind: m[1].toLowerCase() as "team" | "project", id: m[2] } : null;
}

/** 파일 내용에서 검색할 글: 페이지·프레임 이름과 글자(TEXT) */
export function figmaText(doc: FgNode, max = 50_000): string {
  const out: string[] = [];
  let len = 0;
  const walk = (n: FgNode, depth: number) => {
    if (len > max) return;
    let line = "";
    if (n.type === "CANVAS") line = `# ${n.name}`;
    else if ((n.type === "FRAME" || n.type === "SECTION" || n.type === "COMPONENT") && depth <= 2) line = `## ${n.name}`;
    else if (n.type === "TEXT" && n.characters?.trim()) line = n.characters.trim();
    if (line) {
      out.push(line);
      len += line.length;
    }
    for (const c of n.children ?? []) walk(c, depth + 1);
  };
  walk(doc, 0);
  return out.join("\n").slice(0, max);
}

export const figmaFileUrl = (key: string) => `https://www.figma.com/design/${key}`;
export const figmaProjectUrl = (id: string) => `https://www.figma.com/files/project/${id}`;
