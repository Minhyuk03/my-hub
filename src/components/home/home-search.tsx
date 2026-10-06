"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Highlighted, SourceIcon, StateBadge } from "@/components/hub-ui";
import { relTime, shortPath } from "@/lib/format";
import type { SearchHit } from "@/server/search/query";

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
 * 입력하는 동안 아래에 "Google 에서 검색" 과 허브 안의 결과가 함께 뜨고, ↓ 로 허브 결과를 고를 수 있다.
 * 허브 결과는 이 Mac 안에서만 찾는다 (Google 로는 Enter 를 누른 검색어만 간다).
 */
export function HomeSearch() {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [total, setTotal] = useState(0);
  const [sel, setSel] = useState(-1);
  const router = useRouter();
  const seq = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!q.trim()) return;
    const my = ++seq.current;
    const t = setTimeout(async () => {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=8`).then((r) => r.json());
      if (my === seq.current) {
        setHits(r.hits);
        setTotal(r.total);
        setSel(-1);
        setOpen(true);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const shown = q.trim() && open ? hits : [];
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(shown.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(-1, s - 1));
    } else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div ref={box} className="relative w-full max-w-2xl">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (sel >= 0 && shown[sel]) router.push(`/items/${shown[sel].id}`);
          else if (q.trim()) window.location.assign(asUrl(q) ?? googleUrl(q));
        }}
        className="flex items-center gap-3 rounded-full border bg-background px-5 py-3 shadow-lg focus-within:ring-2 focus-within:ring-ring/40"
      >
        <Search className="size-5 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder="Google 검색 또는 주소 입력"
          className="flex-1 bg-transparent text-base outline-none"
          aria-label="Google 검색"
          autoComplete="off"
        />
      </form>
      {q.trim() && open && (
        <div className="absolute inset-x-0 top-full z-20 mt-2 overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-xl">
          <a href={asUrl(q) ?? googleUrl(q)} className={`flex items-center gap-2 px-4 py-2 ${sel === -1 ? "bg-muted" : "hover:bg-muted"}`} onMouseEnter={() => setSel(-1)}>
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
          {shown.length > 0 && <div className="border-t px-4 pb-1 pt-2 text-xs text-muted-foreground">내 허브에서</div>}
          {shown.map((h, i) => (
            <a key={h.id} href={`/items/${h.id}`} className={`block px-4 py-2 ${i === sel ? "bg-muted" : "hover:bg-muted"}`} onMouseEnter={() => setSel(i)}>
              <div className="flex items-center gap-2">
                <SourceIcon kind={h.sourceKind} />
                <span className="truncate font-medium">{h.title}</span>
                <StateBadge state={h.state} sourceStatus={h.sourceStatus} noContentReason={h.noContentReason} />
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{relTime(h.modifiedAt)}</span>
              </div>
              <div className="truncate pl-6 text-xs text-muted-foreground">{shortPath(h.path)}</div>
              {h.snippet && (
                <div className="line-clamp-1 pl-6 text-xs">
                  <Highlighted text={h.snippet} ranges={h.highlights} />
                </div>
              )}
            </a>
          ))}
          {shown.length > 0 && total > shown.length && (
            <a href={`/search?q=${encodeURIComponent(q)}`} className="block border-t px-4 py-2 text-sm text-muted-foreground hover:bg-muted">
              전체 결과 {total.toLocaleString()}건 보기 →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
