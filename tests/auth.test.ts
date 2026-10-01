import { describe, expect, it } from "vitest";
import { AttemptLimiter, createSession, decide, hashPasscode, LISTENER_HEADER, LOCAL_LOGIN, LOCAL_SESSION_COOKIE, pageCsp, sanitizeHeaders, securityHeaders, SESSION_COOKIE, verifyPasscode, verifySession } from "@/server/http/auth";
import { isAllowedHost, isLocalRequest, TAILSCALE_HOST } from "@/server/http/local";

const ME = "me@example.com";
const secret = "test-secret";
const cfg = { allowedLogins: [ME], passcodeHash: hashPasscode("1234"), secret };
const cookie = (login = ME, now = Date.now()) => `${SESSION_COOKIE}=${encodeURIComponent(createSession(login, secret, now))}`;

describe("접속·인증 (7장)", () => {
  it("3000(본인)으로 온 요청의 Tailscale 헤더와 listener 헤더는 지운다", () => {
    const h: Record<string, string | string[] | undefined> = { host: "127.0.0.1:3000", "tailscale-user-login": ME, [LISTENER_HEADER]: "tailscale" };
    sanitizeHeaders(h, "local");
    expect(h["tailscale-user-login"]).toBeUndefined();
    expect(h[LISTENER_HEADER]).toBe("local");
    expect(decide("local", h, "/", cfg).action).toBe("allow");
  });

  it("3001 로 온 요청도 클라이언트가 보낸 listener 헤더는 서버 값으로 바꾼다", () => {
    const h: Record<string, string | string[] | undefined> = { [LISTENER_HEADER]: "local" };
    sanitizeHeaders(h, "tailscale");
    expect(h[LISTENER_HEADER]).toBe("tailscale");
  });

  it("Tailscale 헤더가 있다는 것만으로는 허용하지 않는다: 허용 목록 확인", () => {
    expect(decide("tailscale", {}, "/", cfg)).toMatchObject({ action: "deny", status: 403 });
    expect(decide("tailscale", { "tailscale-user-login": "other@example.com", cookie: cookie("other@example.com") }, "/", cfg)).toMatchObject({ action: "deny" });
  });

  it("허용된 계정이라도 앱 패스코드 세션이 있어야 한다", () => {
    expect(decide("tailscale", { "tailscale-user-login": ME }, "/", cfg).action).toBe("unlock");
    expect(decide("tailscale", { "tailscale-user-login": ME, cookie: cookie() }, "/", cfg).action).toBe("allow");
  });

  it("다른 계정의 세션 쿠키, 만료된 쿠키, 위조 쿠키는 통하지 않는다", () => {
    const allowed2 = { ...cfg, allowedLogins: [ME, "b@example.com"] };
    expect(decide("tailscale", { "tailscale-user-login": "b@example.com", cookie: cookie(ME) }, "/", allowed2).action).toBe("unlock");
    const old = Date.now() - 100 * 86400_000;
    expect(decide("tailscale", { "tailscale-user-login": ME, cookie: cookie(ME, old) }, "/", cfg).action).toBe("unlock");
    expect(verifySession("9999999999999.forged", ME, secret)).toBe(false);
  });

  it("패스코드가 설정되지 않았으면 외부 접속을 막는다", () => {
    expect(decide("tailscale", { "tailscale-user-login": ME }, "/", { ...cfg, passcodeHash: "" })).toMatchObject({ action: "deny" });
  });

  it("패스코드 해시·확인, 틀린 시도 제한", () => {
    const h = hashPasscode("비밀 번호");
    expect(verifyPasscode("비밀 번호", h)).toBe(true);
    expect(verifyPasscode("틀림", h)).toBe(false);
    const lim = new AttemptLimiter(3, 1000);
    for (let i = 0; i < 3; i++) lim.fail(ME, 0);
    expect(lim.locked(ME, 500)).toBe(true);
    expect(lim.locked(ME, 1500)).toBe(false);
  });

  it("Finder 열기 같은 서버 동작은 본인 접속(3000)에서만", () => {
    const h = (o: Record<string, string>) => new Headers(o);
    expect(isLocalRequest(h({ host: "127.0.0.1:3000", [LISTENER_HEADER]: "local" }))).toBe(true);
    expect(isLocalRequest(h({ host: "127.0.0.1:3000", [LISTENER_HEADER]: "tailscale" }))).toBe(false);
    expect(isLocalRequest(h({ host: TAILSCALE_HOST, [LISTENER_HEADER]: "tailscale", "tailscale-user-login": ME }))).toBe(false);
  });

  it("Host 확인: Tailscale 주소는 3001 로 온 요청에서만", () => {
    expect(isAllowedHost(TAILSCALE_HOST, "tailscale")).toBe(true);
    expect(isAllowedHost(TAILSCALE_HOST, "local")).toBe(false);
    expect(isAllowedHost("127.0.0.1:3000", "tailscale")).toBe(false);
    expect(isAllowedHost("evil.example", "tailscale")).toBe(false);
  });
});

describe("Mac mini 본인 접속 패스코드 (선택)", () => {
  const strict = { ...cfg, requireLocalPasscode: true };
  const local = (now = Date.now()) => `${LOCAL_SESSION_COOKIE}=${encodeURIComponent(createSession(LOCAL_LOGIN, secret, now))}`;
  it("켜면 127.0.0.1 접속도 패스코드 세션이 있어야 한다", () => {
    expect(decide("local", {}, "/", cfg).action).toBe("allow");
    expect(decide("local", {}, "/", strict)).toMatchObject({ action: "unlock", login: LOCAL_LOGIN });
    expect(decide("local", { cookie: local() }, "/", strict).action).toBe("allow");
  });
  it("Tailscale 세션 쿠키로는 로컬을 통과할 수 없고, 반대도 마찬가지", () => {
    expect(decide("local", { cookie: cookie() }, "/", strict).action).toBe("unlock");
    expect(decide("tailscale", { "tailscale-user-login": ME, cookie: local() }, "/", strict).action).toBe("unlock");
  });
  it("패스코드가 아직 없으면 잠그지 않는다 (잠겨서 못 들어가는 일 방지)", () => {
    expect(decide("local", {}, "/", { ...strict, passcodeHash: "" }).action).toBe("allow");
  });
});

describe("보안 헤더", () => {
  it("다른 사이트가 허브를 끼워 넣지 못하게 하고, 형식 추측·Referer 유출을 막는다", () => {
    const h = securityHeaders("/");
    expect(h).toMatchObject({ "X-Frame-Options": "DENY", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" });
    expect(securityHeaders("/api/items/3/file")["X-Frame-Options"]).toBe("SAMEORIGIN");
  });
  it("페이지 CSP: nonce 스크립트만, 끼워 넣기 금지", () => {
    const c = pageCsp("abc");
    expect(c).toMatch("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(c).toMatch("frame-ancestors 'none'");
    expect(c).toMatch("object-src 'none'");
    expect(c).not.toMatch("unsafe-eval");
  });
});
