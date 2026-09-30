/**
 * 접속·인증 규칙 (7장). 웹 서버(server.ts)가 Next.js 로 넘기기 전에 모든 요청에 적용한다.
 *
 * - 서버는 포트 두 개를 연다: 3000(Mac mini 본인), 3001(tailscale serve 전용). 둘 다 127.0.0.1 에만 바인딩.
 * - 어느 포트로 들어왔는지(listener)는 서버가 소켓 기준으로 정하고, 클라이언트가 보낸 같은 이름의 헤더는 지운다.
 * - Tailscale 사용자 헤더는 3001 로 들어온 요청에서만 믿는다. 3000 으로 온 요청의 같은 헤더는 지운다.
 * - 3001 요청은 (1) 로그인 계정이 허용 목록에 있고 (2) 앱 패스코드로 받은 세션 쿠키가 있어야 통과한다.
 */
import crypto from "node:crypto";

export type Listener = "local" | "tailscale";
export const LISTENER_HEADER = "x-hub-listener";
export const SESSION_COOKIE = "hub_session";
export const SESSION_DAYS = 90;
export const TAILSCALE_HEADERS = ["tailscale-user-login", "tailscale-user-name", "tailscale-user-profile-pic"];

export type AuthConfig = { allowedLogins: string[]; passcodeHash: string; secret: string };
export type Decision =
  | { action: "allow"; login?: string }
  | { action: "deny"; status: number; message: string }
  | { action: "unlock"; login: string };

/** 들어온 포트에 맞게 헤더를 정리한다. (요청 헤더 객체를 직접 고친다) */
export function sanitizeHeaders(headers: Record<string, string | string[] | undefined>, listener: Listener) {
  delete headers[LISTENER_HEADER];
  if (listener === "local") for (const h of TAILSCALE_HEADERS) delete headers[h];
  headers[LISTENER_HEADER] = listener;
}

/** 모든 요청에 대한 판단 */
export function decide(listener: Listener, headers: Record<string, string | string[] | undefined>, path: string, cfg: AuthConfig, now = Date.now()): Decision {
  if (listener === "local") return { action: "allow" };
  const login = first(headers["tailscale-user-login"]);
  if (!login) return { action: "deny", status: 403, message: "Tailscale 사용자 정보가 없습니다." };
  if (!cfg.allowedLogins.map((x) => x.toLowerCase()).includes(login.toLowerCase()))
    return { action: "deny", status: 403, message: "허용되지 않은 Tailscale 계정입니다." };
  if (!cfg.passcodeHash) return { action: "deny", status: 403, message: "앱 패스코드가 설정되지 않았습니다. Mac mini의 설정 화면에서 먼저 설정하세요." };
  if (path === "/unlock") return { action: "unlock", login };
  const cookie = parseCookies(first(headers.cookie) ?? "")[SESSION_COOKIE];
  if (cookie && verifySession(cookie, login, cfg.secret, now)) return { action: "allow", login };
  return { action: "unlock", login };
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseCookies(h: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of h.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// ---------- 세션 ----------
function sign(data: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

export function createSession(login: string, secret: string, now = Date.now()): string {
  const exp = now + SESSION_DAYS * 86400_000;
  return `${exp}.${sign(`${login.toLowerCase()}|${exp}`, secret)}`;
}

export function verifySession(token: string, login: string, secret: string, now = Date.now()): boolean {
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!exp || !sig || exp < now) return false;
  const expected = sign(`${login.toLowerCase()}|${exp}`, secret);
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

export function sessionCookie(token: string) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

// ---------- 패스코드 ----------
export function hashPasscode(pass: string): string {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = crypto.scryptSync(pass, salt, 32).toString("base64url");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPasscode(pass: string, stored: string): boolean {
  const [kind, salt, hash] = stored.split("$");
  if (kind !== "scrypt" || !salt || !hash) return false;
  const got = crypto.scryptSync(pass, salt, 32);
  const want = Buffer.from(hash, "base64url");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/** 패스코드 시도 제한: 계정별 5번 틀리면 10분 잠금 */
export class AttemptLimiter {
  private fails = new Map<string, { n: number; until: number }>();
  constructor(
    private max = 5,
    private lockMs = 10 * 60_000,
  ) {}
  locked(key: string, now = Date.now()) {
    const f = this.fails.get(key);
    return !!f && f.until > now;
  }
  fail(key: string, now = Date.now()) {
    const f = this.fails.get(key) ?? { n: 0, until: 0 };
    f.n++;
    if (f.n >= this.max) {
      f.until = now + this.lockMs;
      f.n = 0;
    }
    this.fails.set(key, f);
  }
  success(key: string) {
    this.fails.delete(key);
  }
}
