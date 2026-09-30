import { NextResponse, type NextRequest } from "next/server";
import { isAllowedHost } from "@/server/http/local";

/**
 * 모든 요청의 Host 헤더를 확인한다.
 * 악성 웹페이지가 DNS rebinding 으로 127.0.0.1:3000 에 접근하는 것을 막는다.
 */
export function proxy(request: NextRequest) {
  if (!isAllowedHost(request.headers.get("host"))) {
    return new NextResponse("허용되지 않은 주소입니다.", { status: 403 });
  }
  // 쓰기 요청은 같은 출처에서 온 것만 허용 (CSRF 방어). 서버 액션은 Next.js 가 Origin 을 따로 확인한다.
  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== request.headers.get("host")) {
      return new NextResponse("허용되지 않은 요청입니다.", { status: 403 });
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
