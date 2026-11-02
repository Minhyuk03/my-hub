import { Settings } from "lucide-react";
import Link from "next/link";
import { HeaderShell } from "./header-shell";
import { NavButtons } from "./nav-buttons";
import { NavLinks } from "./nav-links";
import { SearchPalette } from "./search-palette";
import { ThemeToggle } from "./theme-toggle";

/** 상단 메뉴 (영문 대문자 표기, 한글 이름은 마우스를 올리면) */
export const NAV = [
  { href: "/hub", label: "Hub", title: "허브: 파일 탐색" },
  { href: "/graph", label: "Graph", title: "그래프" },
  { href: "/projects", label: "PARA", title: "PARA · 프로젝트" },
  { href: "/chat", label: "AI Chat", title: "AI 채팅" },
  { href: "/ai-code", label: "AI Code", title: "AI 코드" },
];

/** 포트폴리오 디자인의 메뉴 줄: 왼쪽 로고(이름), 가운데 메뉴, 오른쪽 검색·테마·설정 */
export function AppHeader({ brand }: { brand: string }) {
  return (
    <HeaderShell>
      {/* 본문(main: max-w-6xl, px-4)과 같은 폭이라 로고가 본문 왼쪽 끝과 맞는다 */}
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-3 px-4 py-4 sm:gap-x-6">
        <NavButtons />
        <Link href="/" className="min-w-0 truncate text-base font-normal tracking-[0.2em] sm:tracking-[0.3em]" title="자기소개 · 포트폴리오">
          {brand}
        </Link>
        <div className="order-last w-full sm:order-none sm:ml-auto sm:w-auto">
          <NavLinks items={NAV} />
        </div>
        <div className="ml-auto flex items-center gap-0.5 sm:ml-0">
          <SearchPalette />
          <ThemeToggle />
          <Link
            href="/settings"
            aria-label="설정 · 동기화 상태 · AI 정리"
            title="설정 · 동기화 상태 · AI 정리"
            className="-mr-2 flex size-8 items-center justify-center rounded-sm opacity-70 hover:bg-current/10 hover:opacity-100"
          >
            <Settings className="size-4" />
          </Link>
        </div>
      </div>
    </HeaderShell>
  );
}
