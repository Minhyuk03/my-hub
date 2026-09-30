import { describe, expect, it } from "vitest";
import { isAllowedHost, isLocalRequest } from "@/server/http/local";

const h = (o: Record<string, string>) => new Headers(o);

describe("서버 본인 접속 판별 (7장, Phase 1 범위)", () => {
  it("127.0.0.1:3000 직접 접속은 로컬", () => {
    expect(isLocalRequest(h({ host: "127.0.0.1:3000", "x-forwarded-for": "127.0.0.1", "x-forwarded-host": "127.0.0.1:3000" }))).toBe(true);
    expect(isLocalRequest(h({ host: "localhost:3000" }))).toBe(true);
  });
  it("Tailscale 사용자 헤더가 있으면 로컬이 아니다", () => {
    expect(isLocalRequest(h({ host: "127.0.0.1:3000", "tailscale-user-login": "me@example.com" }))).toBe(false);
  });
  it("다른 주소에서 전달된 요청은 로컬이 아니다", () => {
    expect(isLocalRequest(h({ host: "127.0.0.1:3000", "x-forwarded-for": "100.64.0.2" }))).toBe(false);
    expect(isLocalRequest(h({ host: "127.0.0.1:3000", "x-forwarded-host": "hub.tailnet.ts.net" }))).toBe(false);
    expect(isLocalRequest(h({ host: "mac-mini.local:3000" }))).toBe(false);
  });
  it("허용되지 않은 Host 는 거부 (DNS rebinding 방어)", () => {
    expect(isAllowedHost("127.0.0.1:3000")).toBe(true);
    expect(isAllowedHost("evil.example:3000")).toBe(false);
    expect(isAllowedHost(null)).toBe(false);
  });
});
