import { Settings } from "lucide-react";
import Link from "next/link";
import { SearchPalette } from "./search-palette";
import { ThemeToggle } from "./theme-toggle";
import { NavButtons } from "./nav-buttons";
import { NavLinks } from "./nav-links";

const NAV = [
  { href: "/graph", label: "그래프" },
  { href: "/projects", label: "PARA" },
  { href: "/chat", label: "AI 채팅" },
  { href: "/ai-code", label: "AI 코드" },
];

export function AppHeader() {
  return (
    <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
      {/* 본문(main: max-w-6xl, px-4)과 같은 폭·여백이라 메뉴 줄의 왼쪽 끝이 본문 왼쪽 끝과 맞는다 */}
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <NavButtons />
        <Link href="/" className="font-semibold">
          나의 허브
        </Link>
        <NavLinks items={NAV} />
        <SearchPalette />
        {/* 오른쪽 끝: 라이트/다크 · 설정(톱니, 안에 동기화 상태·AI 정리·중복 파일) */}
        <div className="ml-auto flex items-center gap-0.5 sm:ml-0">
          <ThemeToggle />
          <Link href="/settings" aria-label="설정 · 동기화 상태 · AI 정리" title="설정 · 동기화 상태 · AI 정리" className="-mr-2 flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
            <Settings className="size-4" />
          </Link>
        </div>
      </div>
    </header>
  );
}
