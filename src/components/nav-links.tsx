"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** 상단 글자 메뉴: 작은 대문자·넓은 자간. 지금 있는 페이지는 진하게 + 밑줄. 글자색은 메뉴 줄에서 물려받는다 */
export function NavLinks({ items }: { items: { href: string; label: string; title?: string }[] }) {
  const pathname = usePathname();
  return (
    // 휴대폰에서만 옆으로 밀 수 있게(스크롤바는 숨김). 넓은 화면은 다 들어가므로 넘침을 자르지 않는다 (마지막 글자 자간·밑줄 때문에 스크롤바가 생기던 문제)
    <nav className="flex gap-6 overflow-x-auto overflow-y-hidden pb-1 text-[11px] font-normal uppercase tracking-[0.25em] whitespace-nowrap [scrollbar-width:none] sm:overflow-visible [&::-webkit-scrollbar]:hidden">
      {items.map((n) => {
        const active = pathname === n.href || pathname.startsWith(n.href + "/");
        return (
          <Link
            key={n.href}
            href={n.href}
            title={n.title}
            aria-current={active ? "page" : undefined}
            className={`relative py-1 transition-opacity ${active ? "opacity-100 after:absolute after:inset-x-0 after:-bottom-0.5 after:h-px after:bg-current" : "opacity-65 hover:opacity-100"}`}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
