import Link from "next/link";
import { SearchPalette } from "./search-palette";
import { ThemeToggle } from "./theme-toggle";
import { NavButtons } from "./nav-buttons";

const NAV = [
  { href: "/graph", label: "그래프" },
  { href: "/projects", label: "프로젝트" },
  { href: "/chat", label: "AI 채팅" },
  { href: "/ai", label: "AI 정리" },
  { href: "/status", label: "동기화 상태" },
  { href: "/settings", label: "설정" },
];

export function AppHeader() {
  return (
    <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
      <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
        <NavButtons />
        <Link href="/" className="font-semibold">
          나의 허브
        </Link>
        <nav className="flex gap-3 text-sm text-muted-foreground">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="hover:text-foreground">
              {n.label}
            </Link>
          ))}
        </nav>
        <SearchPalette />
        <ThemeToggle />
      </div>
    </header>
  );
}
