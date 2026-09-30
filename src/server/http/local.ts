/**
 * 요청이 Mac mini 본인 브라우저에서 직접 온 것인지 판단한다.
 * "Finder에서 보기"처럼 서버에서 프로그램을 실행하는 동작은 이 경우에만 허용한다.
 *
 * Phase 1: 서버는 127.0.0.1:3000 에만 바인딩한다.
 * Phase 2: tailscale serve 는 별도 포트(3001)로 들어오며, 그 요청은 로컬 요청으로 보지 않는다.
 */
export const LOCAL_HOSTS = new Set(["127.0.0.1:3000", "localhost:3000"]);
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const TAILSCALE_HEADERS = ["tailscale-user-login", "tailscale-user-name", "tailscale-user-profile-pic"];

type HeaderLike = { get(name: string): string | null };

export function isLocalRequest(h: HeaderLike): boolean {
  const host = h.get("host") ?? "";
  if (!LOCAL_HOSTS.has(host)) return false;
  if (TAILSCALE_HEADERS.some((k) => h.get(k))) return false;
  // Next.js 가 x-forwarded-* 를 스스로 붙이므로, 있더라도 모두 루프백 주소일 때만 로컬로 본다
  const xff = h.get("x-forwarded-for");
  if (xff && !xff.split(",").every((a) => LOOPBACK.has(a.trim()))) return false;
  const xfh = h.get("x-forwarded-host");
  if (xfh && !LOCAL_HOSTS.has(xfh)) return false;
  return true;
}

/** 허용된 Host 인지 (DNS rebinding 방어). Phase 2에서 Tailscale 주소를 추가한다. */
export function isAllowedHost(host: string | null): boolean {
  return !!host && LOCAL_HOSTS.has(host);
}
