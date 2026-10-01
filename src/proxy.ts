import { NextResponse, type NextRequest } from "next/server";
import { LISTENER_HEADER, pageCsp } from "@/server/http/auth";
import { isAllowedHost } from "@/server/http/local";

/**
 * 모든 요청의 Host 헤더를 확인한다.
 * 악성 웹페이지가 DNS rebinding 으로 127.0.0.1:3000 에 접근하는 것을 막는다.
 */
export function proxy(request: NextRequest) {
  if (!isAllowedHost(request.headers.get("host"), request.headers.get(LISTENER_HEADER))) {
    return new NextResponse("허용되지 않은 주소입니다.", { status: 403 });
  }
  // 쓰기 요청은 같은 출처에서 온 것만 허용 (CSRF 방어). 서버 액션은 Next.js 가 Origin 을 따로 확인한다.
  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== request.headers.get("host")) {
      return new NextResponse("허용되지 않은 요청입니다.", { status: 403 });
    }
  }
  // 페이지 CSP: 요청마다 nonce 를 만들어 Next.js(자기 스크립트)와 레이아웃(테마·서비스 워커 스크립트)이 쓰게 한다
  const nonce = btoa(crypto.randomUUID());
  const csp = pageCsp(nonce, process.env.NODE_ENV !== "production");
  const reqHeaders = new Headers(request.headers);
  reqHeaders.set("x-nonce", nonce);
  reqHeaders.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers: reqHeaders } });
  // 원본 파일 응답은 서버가 따로 sandbox CSP 를 붙인다
  if (!/^\/api\/items\/\d+\/file$/.test(request.nextUrl.pathname)) res.headers.set("Content-Security-Policy", csp);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
