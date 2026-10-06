import Link from "next/link";

const TABS = [
  { href: "/settings", label: "설정" },
  { href: "/status", label: "동기화 상태" },
  { href: "/ai", label: "AI 정리" },
  { href: "/duplicates", label: "중복 파일" },
];

/** 설정(톱니) 안의 탭: 설정 · 동기화 상태 · AI 정리 · 중복 파일 */
export function SettingsTabs({ current }: { current: string }) {
  return (
    // 좁은 화면에서는 옆으로 밀 수 있게(스크롤바는 숨김). 아래 선은 안쪽 그림자로 그려 밑줄이 줄 밖으로 삐져나오지 않게 한다
    <nav className="flex gap-1 overflow-x-auto overflow-y-hidden text-sm shadow-[inset_0_-1px_0_var(--color-border)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.href === current ? "page" : undefined}
          className={`shrink-0 border-b-2 px-3 py-2 ${t.href === current ? "border-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
