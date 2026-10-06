"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** 상단 글자 메뉴: 지금 있는 페이지는 글자를 밝게 + 아래 짧은 선으로 표시 */
export function NavLinks({ items }: { items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-3 text-sm text-muted-foreground">
      {items.map((n) => {
        const active = pathname === n.href || pathname.startsWith(n.href + "/");
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={`relative py-1 transition-colors hover:text-foreground ${active ? "text-foreground after:absolute after:inset-x-0 after:-bottom-0.5 after:h-0.5 after:rounded-full after:bg-foreground" : ""}`}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
