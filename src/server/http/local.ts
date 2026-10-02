/**
 * 요청이 Mac mini 본인 브라우저에서 직접 온 것인지 판단한다.
 * "Finder에서 보기"처럼 서버에서 프로그램을 실행하는 동작은 이 경우에만 허용한다.
 *
 * 웹 서버(server.ts)는 3000(본인)·3001(Tailscale) 두 포트를 열고, 들어온 포트를 x-hub-listener 헤더로 표시한다.
 * (클라이언트가 보낸 같은 이름의 헤더는 서버가 지운다)
 */
import { LISTENER_HEADER } from "./auth";

export const LOCAL_HOSTS = new Set(["127.0.0.1:3000", "localhost:3000"]);
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const TAILSCALE_HEADERS = ["tailscale-user-login", "tailscale-user-name", "tailscale-user-profile-pic"];

/**
 * Tailscale 로 들어올 때 허용하는 주소 (MagicDNS 이름, 예: myhub.talpa-nunki.ts.net)
 * 웹 서버(server.ts)가 `tailscale status` 로 이 Mac 의 이름을 1분마다 읽어 HUB_TAILSCALE_HOST 에 넣는다.
 * → Tailscale 관리 화면에서 기기·tailnet 이름을 바꿔도 코드를 고칠 필요가 없다. 모르면 빈 값(외부 접속 불가).
 */
export const tailscaleHost = () => process.env.HUB_TAILSCALE_HOST ?? "";

type HeaderLike = { get(name: string): string | null };

export function isLocalRequest(h: HeaderLike): boolean {
  const listener = h.get(LISTENER_HEADER);
  if (listener && listener !== "local") return false;
  const host = h.get("host") ?? "";
  if (!LOCAL_HOSTS.has(host)) return false;
  if (TAILSCALE_HEADERS.some((k) => h.get(k))) return false;
  // Next.js 가 x-forwarded-* 를 스스로 붙이므로, 있더라도 모두 루프백 주소일 때만 로컬로 본다
  const xff = h.get("x-forwarded-for");
  if (xff && !xff.split(",").every((a) => LOOPBACK.has(a.trim()))) return false;
  const xfh = h.get("x-forwarded-host");
  if (xfh && !LOCAL_HOSTS.has(xfh) && xfh !== tailscaleHost()) return false;
  return true;
}

/** 허용된 Host 인지 (DNS rebinding 방어). Tailscale 주소는 3001 로 들어온 요청에서만 허용. */
export function isAllowedHost(host: string | null, listener: string | null = "local"): boolean {
  if (!host) return false;
  if (listener === "tailscale") return !!tailscaleHost() && host === tailscaleHost();
  return LOCAL_HOSTS.has(host);
}
