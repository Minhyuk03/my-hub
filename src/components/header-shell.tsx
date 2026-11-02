"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * 맨 위 메뉴 줄의 겉: 첫 화면(/)에서는 사진 위에 투명하게 겹쳐 흰 글씨, 내려가면 흰 바탕으로.
 * 다른 화면에서는 늘 흰 바탕으로 위에 붙어 있다. 안쪽 요소는 글자색을 물려받는다(currentColor).
 */
export function HeaderShell({ children }: { children: React.ReactNode }) {
  const home = usePathname() === "/";
  const [top, setTop] = useState(true);
  useEffect(() => {
    if (!home) return;
    const onScroll = () => setTop(window.scrollY < 320);
    const raf = requestAnimationFrame(onScroll); // 새로 고침 뒤 스크롤 위치가 남아 있어도 맞게
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, [home]);
  const over = home && top;
  return (
    <header
      data-over={over}
      className={`${home ? "fixed inset-x-0" : "sticky"} top-0 z-30 transition-colors duration-300 ${
        over ? "border-b border-transparent bg-transparent text-white" : "border-b bg-background/95 text-foreground backdrop-blur"
      }`}
    >
      {children}
    </header>
  );
}
