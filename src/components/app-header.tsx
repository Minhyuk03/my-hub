import Link from "next/link";
import { Search } from "lucide-react";
import { ThemeToggle } from "./theme-toggle";

const NAV = [
  { href: "/", label: "홈" },
  { href: "/projects", label: "프로젝트" },
  { href: "/status", label: "동기화 상태" },
  { href: "/settings", label: "설정" },
];

export function AppHeader() {
  return (
    <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
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
        <div className="order-last flex w-full items-center gap-2 rounded-md border px-3 py-1.5 text-sm text-muted-foreground sm:order-none sm:ml-auto sm:w-72">
          <Search className="size-4" />
          <span className="flex-1">검색 (Phase 1에서 사용 가능)</span>
          <kbd className="rounded border px-1 text-xs">⌘K</kbd>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}
