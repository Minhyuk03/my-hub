/**
 * Google Drive API 클라이언트 (읽기 전용, drive.readonly)
 * - access token 은 메모리에만 두고, refresh token 은 키체인(TokenStore)에 둔다.
 * - 요청이 많아 거절되면(429·403 rateLimit·5xx) 간격을 늘려 다시 시도한다.
 * - refresh token 이 만료·취소되면 TokenError → 소스를 오프라인("다시 연결 필요")으로 표시한다.
 */
import type { TokenStore } from "./tokens";

export const SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const API = "https://www.googleapis.com/drive/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const SHORTCUT_MIME = "application/vnd.google-apps.shortcut";
/** Google 문서류를 텍스트로 받는 형식 */
export const EXPORTS: Record<string, { mime: string; ext: string; label: string }> = {
  "application/vnd.google-apps.document": { mime: "text/plain", ext: "gdoc", label: "Google 문서" },
  "application/vnd.google-apps.presentation": { mime: "text/plain", ext: "gslides", label: "Google 프레젠테이션" },
  "application/vnd.google-apps.spreadsheet": { mime: "text/csv", ext: "gsheet", label: "Google 스프레드시트" },
};

export const FILE_FIELDS = "id,name,mimeType,parents,modifiedTime,createdTime,size,md5Checksum,webViewLink,trashed";

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  modifiedTime?: string;
  createdTime?: string;
  size?: string;
  md5Checksum?: string;
  webViewLink?: string;
  trashed?: boolean;
};
export type DriveChange = { fileId: string; removed?: boolean; file?: DriveFile };

export class TokenError extends Error {}
export class NotConnectedError extends TokenError {}

export type DriveDeps = {
  fetch: typeof fetch;
  tokens: TokenStore;
  clientId: string;
  clientSecret: string;
  sleep?: (ms: number) => Promise<void>;
};

export class DriveClient {
  private access: { token: string; exp: number } | null = null;
  constructor(private d: DriveDeps) {}

  private async accessToken(): Promise<string> {
    if (this.access && this.access.exp > Date.now() + 60_000) return this.access.token;
    const refresh = await this.d.tokens.get();
    if (!refresh) throw new NotConnectedError("Google Drive 가 연결되어 있지 않습니다.");
    const r = await this.d.fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: this.d.clientId, client_secret: this.d.clientSecret, refresh_token: refresh, grant_type: "refresh_token" }),
    });
    const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!r.ok || !j.access_token) {
      if (j.error === "invalid_grant" || j.error === "unauthorized_client" || j.error === "invalid_client")
        throw new TokenError("Google 연결이 만료되었습니다. 설정에서 다시 연결하세요.");
      throw new Error(`토큰 갱신 실패 (${r.status})`);
    }
    this.access = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
    return j.access_token;
  }

  /** 요청 + 재시도 (1초 → 2초 → 4초 → 8초 → 16초) */
  async request(pathOrUrl: string, params: Record<string, string> = {}, raw = false): Promise<Response> {
    const url = new URL(pathOrUrl.startsWith("http") ? pathOrUrl : API + pathOrUrl);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const sleep = this.d.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    for (let attempt = 0; ; attempt++) {
      const r = await this.d.fetch(url, { headers: { Authorization: `Bearer ${await this.accessToken()}` } });
      if (r.status === 401 && attempt === 0) {
        this.access = null;
        continue;
      }
      const retryable = r.status === 429 || r.status >= 500 || (r.status === 403 && /rateLimit|userRateLimit/i.test(await r.clone().text()));
      if (retryable && attempt < 5) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (!r.ok) throw new Error(`Drive API 오류 ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return raw ? r : r;
    }
  }

  async json<T>(p: string, params: Record<string, string> = {}): Promise<T> {
    return (await this.request(p, params)).json() as Promise<T>;
  }

  about() {
    return this.json<{ user: { emailAddress: string; displayName: string } }>("/about", { fields: "user(emailAddress,displayName)" });
  }

  getFile(id: string) {
    return this.json<DriveFile>(`/files/${encodeURIComponent(id)}`, { fields: FILE_FIELDS, supportsAllDrives: "false" });
  }

  /** 폴더 바로 아래 항목 (한 페이지) */
  listChildren(folderId: string, pageToken?: string, onlyFolders = false) {
    const q = `'${folderId.replace(/'/g, "\\'")}' in parents and trashed = false${onlyFolders ? ` and mimeType = '${FOLDER_MIME}'` : ""}`;
    return this.json<{ files: DriveFile[]; nextPageToken?: string }>("/files", {
      q,
      fields: `nextPageToken,files(${FILE_FIELDS})`,
      pageSize: "1000",
      orderBy: "folder,name",
      ...(pageToken ? { pageToken } : {}),
    });
  }

  startPageToken() {
    return this.json<{ startPageToken: string }>("/changes/startPageToken").then((r) => r.startPageToken);
  }

  changes(pageToken: string) {
    return this.json<{ changes: DriveChange[]; nextPageToken?: string; newStartPageToken?: string }>("/changes", {
      pageToken,
      fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`,
      pageSize: "1000",
      includeRemoved: "true",
      restrictToMyDrive: "true",
      spaces: "drive",
    });
  }

  /** 내용 받기: Google 문서류는 텍스트로 변환, 나머지는 원본 */
  async content(f: DriveFile): Promise<Buffer> {
    const ex = EXPORTS[f.mimeType];
    const r = ex
      ? await this.request(`/files/${encodeURIComponent(f.id)}/export`, { mimeType: ex.mime })
      : await this.request(`/files/${encodeURIComponent(f.id)}`, { alt: "media" });
    return Buffer.from(await r.arrayBuffer());
  }

  /** 원본 내려받기 응답 (웹 화면에서 그대로 흘려보냄). Google 문서류는 PDF 로 변환 */
  download(f: DriveFile) {
    return EXPORTS[f.mimeType]
      ? this.request(`/files/${encodeURIComponent(f.id)}/export`, { mimeType: "application/pdf" })
      : this.request(`/files/${encodeURIComponent(f.id)}`, { alt: "media" });
  }
}

// ---------- OAuth (처음 연결) ----------
export function authUrl(o: { clientId: string; redirectUri: string; state: string; codeChallenge: string }) {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: o.state,
    code_challenge: o.codeChallenge,
    code_challenge_method: "S256",
  }).toString();
  return u.toString();
}

export async function exchangeCode(f: typeof fetch, o: { clientId: string; clientSecret: string; code: string; verifier: string; redirectUri: string }) {
  const r = await f(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: o.clientId,
      client_secret: o.clientSecret,
      code: o.code,
      code_verifier: o.verifier,
      grant_type: "authorization_code",
      redirect_uri: o.redirectUri,
    }),
  });
  const j = (await r.json().catch(() => ({}))) as { refresh_token?: string; scope?: string; error?: string; error_description?: string };
  if (!r.ok || !j.refresh_token) throw new Error(j.error_description || j.error || "Google 연결에 실패했습니다.");
  if (j.scope && !j.scope.includes(SCOPE)) throw new Error("Drive 읽기 권한이 허용되지 않았습니다. 권한 화면에서 체크해 주세요.");
  return j.refresh_token;
}

export function driveEnv() {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  return { clientId, clientSecret, configured: !!clientId && !!clientSecret };
}

export const folderUrl = (id: string) => `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`;

/** "테스트 중" 앱의 연결 만료 (연결 후 7일). 남은 시간과 상태를 돌려준다 */
export function driveExpiry(account: { connectedAt: number } | null, testingMode: boolean, now = Date.now()) {
  if (!account || !testingMode) return null;
  const expiresAt = account.connectedAt + 7 * 86400_000;
  const left = expiresAt - now;
  return { expiresAt, leftDays: Math.max(0, Math.ceil(left / 86400_000)), expired: left <= 0, soon: left < 36 * 3600_000 };
}
