"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** 화면마다 맨 위에 붙는 작은 영문 라벨 (포트폴리오의 섹션 제목과 같은 글씨) */
const LABELS: [string, string][] = [
  ["/profile/edit", "Edit Profile"],
  ["/home/edit", "Edit Hub"],
  ["/hub", "Hub"],
  ["/search", "Search"],
  ["/recent", "Recent"],
  ["/projects", "PARA"],
  ["/graph", "Graph"],
  ["/chat", "AI Chat"],
  ["/ai-code", "AI Code"],
  ["/ai", "AI"],
  ["/settings", "Settings"],
  ["/status", "Status"],
  ["/duplicates", "Duplicates"],
  ["/items", "File"],
  ["/folders", "Folder"],
];

export function PageLabel() {
  const pathname = usePathname();
  if (pathname === "/") return null;
  const label = LABELS.find(([p]) => pathname === p || pathname.startsWith(p + "/"))?.[1];
  if (!label) return null;
  return (
    <div className="mb-6 flex items-center gap-4" aria-hidden>
      <span className="text-[11px] font-normal uppercase tracking-[0.3em] text-primary">{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

/** 아래 짙은 회색 띠 (첫 화면은 자기 연락처 띠가 있어 뺀다) */
export function SiteFooter({ brand, links }: { brand: string; links: { href: string; label: string }[] }) {
  if (usePathname() === "/") return null;
  return (
    <footer className="mt-16 bg-[var(--footer)] text-sm text-white/65">
      <div className="mx-auto flex max-w-6xl flex-wrap items-start gap-x-16 gap-y-6 px-4 py-10">
        <div className="space-y-2">
          <Link href="/" className="text-lg font-normal tracking-[0.3em] text-white">
            {brand}
          </Link>
          <p className="text-xs text-white/40">흩어진 작업물을 한곳에서 · 개인 허브</p>
        </div>
        <nav className="ml-auto flex flex-wrap gap-x-6 gap-y-2 text-[11px] uppercase tracking-[0.25em]">
          <Link href="/" className="hover:text-white">
            Portfolio
          </Link>
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-white">
              {l.label}
            </Link>
          ))}
          <Link href="/settings" className="hover:text-white">
            Settings
          </Link>
        </nav>
      </div>
    </footer>
  );
}
