import { describe, expect, it } from "vitest";
import { AttemptLimiter, createSession, decide, hashPasscode, LISTENER_HEADER, sanitizeHeaders, SESSION_COOKIE, verifyPasscode, verifySession } from "@/server/http/auth";
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
