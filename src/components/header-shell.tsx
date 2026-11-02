"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * 맨 위 메뉴 줄의 겉: 첫 화면(/)에서는 사진 위에 투명하게 겹쳐 흰 글씨, 아래 내용이 올라와 닿으면 흰 바탕으로.
 * 다른 화면에서는 늘 흰 바탕으로 위에 붙어 있다. 안쪽 요소는 글자색을 물려받는다(currentColor).
 */
export function HeaderShell({ children }: { children: React.ReactNode }) {
  const home = usePathname() === "/";
  const [top, setTop] = useState(true);
  useEffect(() => {
    if (!home) return;
    // 아래 내용 판이 메뉴 줄에 닿을 때까지는 사진 위에 투명하게
    const onScroll = () => setTop(window.scrollY < window.innerHeight - 72);
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
        over
          ? "border-b border-transparent bg-transparent text-white"
          : // 첫 화면은 뒤의 사진이 비치게 반투명, 다른 화면은 거의 불투명
            `border-b text-foreground backdrop-blur-md ${home ? "bg-background/70" : "bg-background/95"}`
      }`}
    >
      {children}
    </header>
  );
}
