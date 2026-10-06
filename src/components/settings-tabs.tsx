import Link from "next/link";

const TABS = [
  { href: "/settings", label: "설정" },
  { href: "/status", label: "동기화 상태" },
  { href: "/duplicates", label: "중복 파일" },
];

/** 설정(톱니) 안의 탭: 설정 · 동기화 상태 · 중복 파일 */
export function SettingsTabs({ current }: { current: string }) {
  return (
    <nav className="flex gap-1 border-b text-sm">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          aria-current={t.href === current ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-2 ${t.href === current ? "border-foreground font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
