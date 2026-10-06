"use client";

import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** 주소처럼 보이면(example.com, https://…) 그 주소로 바로 간다 */
export function asUrl(q: string): string | null {
  const t = q.trim();
  if (/^https?:\/\/\S+$/i.test(t)) return t;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(t) && !/\s/.test(t)) return `https://${t}`;
  return null;
}
export const googleUrl = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q.trim())}`;

/**
 * 홈 가운데 큰 검색창: 크롬 시작 페이지처럼 Enter 는 Google 검색(주소면 그 주소로).
 * 허브 안을 찾는 것은 위쪽 메뉴의 검색창(⌘K)을 쓴다.
 */
export function HomeSearch() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const target = q.trim() ? (asUrl(q) ?? googleUrl(q)) : null;

  return (
    <div ref={box} className="relative w-full max-w-2xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (target) window.location.assign(target);
        }}
        className="flex items-center gap-3 rounded-full border bg-background px-5 py-3 shadow-lg focus-within:ring-2 focus-within:ring-ring/40"
      >
        <Search className="size-5 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
          placeholder="Google 검색 또는 주소 입력"
          className="flex-1 bg-transparent text-base outline-none"
          aria-label="Google 검색"
          autoComplete="off"
        />
      </form>
      {target && open && (
        <div className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-xl">
          <a href={target} className="flex items-center gap-2 bg-muted px-4 py-2">
            <Search className="size-4 text-muted-foreground" />
            <span className="truncate">
              {asUrl(q) ? (
                <>
                  <span className="font-medium">{asUrl(q)}</span> 열기
                </>
              ) : (
                <>
                  <span className="font-medium">{q.trim()}</span> <span className="text-muted-foreground">— Google 검색</span>
                </>
              )}
            </span>
            <span className="ml-auto text-xs text-muted-foreground">Enter</span>
          </a>
        </div>
      )}
    </div>
  );
}
