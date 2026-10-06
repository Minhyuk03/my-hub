"use client";

import { ArrowLeft, ArrowRight, House } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Nav = { canGoBack?: boolean; canGoForward?: boolean; addEventListener?: (t: string, f: () => void) => void; removeEventListener?: (t: string, f: () => void) => void };

/** 뒤로 · 앞으로 · 홈 (아이폰 홈 화면 앱처럼 브라우저 버튼이 없을 때도 쓸 수 있게) */
export function NavButtons() {
  const router = useRouter();
  const pathname = usePathname();
  // 브라우저가 알려 주면(Navigation API) 갈 곳이 없을 때 흐리게, 모르면 항상 켜 둔다
  const [can, setCan] = useState<{ back: boolean; forward: boolean }>({ back: true, forward: true });
  useEffect(() => {
    const nav = (window as unknown as { navigation?: Nav }).navigation;
    if (!nav || nav.canGoBack === undefined) return;
    const update = () => setCan({ back: !!nav.canGoBack, forward: !!nav.canGoForward });
    const t = setTimeout(update, 0);
    nav.addEventListener?.("currententrychange", update);
    return () => {
      clearTimeout(t);
      nav.removeEventListener?.("currententrychange", update);
    };
  }, [pathname]);
  const btn = "flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30";
  return (
    // 넓은 화면(1400px 이상, 본문 옆에 빈 공간이 충분할 때)에서는 창 왼쪽 끝에 붙이고,
    // 좁은 화면에서는 메뉴 줄 맨 앞에 둔다 (아이콘이 본문 왼쪽 끝과 맞도록 버튼 여백만큼 당김).
    // 긴 페이지는 스크롤바 폭만큼 화면 전체가 오른쪽으로 옮겨지므로(globals.css 의 html margin-left), 그 절반만큼 되돌려 창 끝에서 항상 같은 거리에 둔다
    <div className="-ml-2 flex items-center gap-0.5 min-[1400px]:absolute min-[1400px]:top-1/2 min-[1400px]:left-[calc(0.75rem_-_(100vw_-_100%)_/_2)] min-[1400px]:ml-0 min-[1400px]:-translate-y-1/2">
      <button type="button" className={btn} onClick={() => router.back()} disabled={!can.back} aria-label="뒤로 가기" title="뒤로 가기">
        <ArrowLeft className="size-4" />
      </button>
      <button type="button" className={btn} onClick={() => router.forward()} disabled={!can.forward} aria-label="앞으로 가기" title="앞으로 가기">
        <ArrowRight className="size-4" />
      </button>
      <Link href="/" className={`${btn} ${pathname === "/" ? "text-foreground" : ""}`} aria-label="홈" title="홈">
        <House className="size-4" />
      </Link>
    </div>
  );
}
