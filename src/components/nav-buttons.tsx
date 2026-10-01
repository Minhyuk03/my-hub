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
    <div className="flex items-center gap-0.5">
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
