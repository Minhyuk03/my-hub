"use client";

import { Command } from "cmdk";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Highlighted, SourceIcon, StateBadge } from "@/components/hub-ui";
import { relTime, shortPath } from "@/lib/format";
import type { SearchHit } from "@/server/search/query";
import { savedCategories } from "./category-filter";

/** 검색 화면에서 고른 분류(기억해 둔 것)를 ⌘K 검색에도 쓴다 */
const catQuery = () => (savedCategories() ?? []).map((c) => `&cat=${c}`).join("");

/** 상단 검색창 + ⌘K 어디서든 열리는 검색 */
export function SearchPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const seq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!q.trim()) return;
    const my = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=15${catQuery()}`).then((r) => r.json());
        if (my === seq.current) {
          setHits(r.hits);
          setTotal(r.total);
        }
      } finally {
        if (my === seq.current) setLoading(false);
      }
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  const shown = q.trim() ? hits : [];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="order-last flex w-full items-center gap-2 rounded-md border px-3 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted sm:order-none sm:ml-auto sm:w-72"
      >
        <Search className="size-4" />
        <span className="flex-1">검색</span>
        <kbd className="hidden rounded border px-1 text-xs sm:inline">⌘K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 p-2 pt-[10vh] sm:p-4 sm:pt-[12vh]" onMouseDown={() => setOpen(false)}>
          <Command
            shouldFilter={false}
            className="mx-auto max-w-2xl overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b px-3">
              <Search className="size-4 text-muted-foreground" />
              <Command.Input
                autoFocus
                value={q}
                onValueChange={setQ}
                placeholder="파일, 노트, 경로 검색…"
                className="h-12 flex-1 bg-transparent text-base outline-none"
              />
              {loading && <span className="text-xs text-muted-foreground">검색 중</span>}
            </div>
            <Command.List className="max-h-[60vh] overflow-y-auto p-1">
              {q.trim() && !loading && !shown.length && <Command.Empty className="p-4 text-sm text-muted-foreground">결과가 없습니다.</Command.Empty>}
              {shown.map((h) => (
                <Command.Item
                  key={h.id}
                  value={String(h.id)}
                  onSelect={() => go(`/items/${h.id}`)}
                  className="cursor-pointer rounded-md px-2 py-2 data-[selected=true]:bg-muted"
                >
                  <div className="flex items-center gap-2">
                    <SourceIcon kind={h.sourceKind} />
                    <span className="truncate font-medium">{h.title}</span>
                    <StateBadge state={h.state} sourceStatus={h.sourceStatus} noContentReason={h.noContentReason} />
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{relTime(h.modifiedAt)}</span>
                  </div>
                  <div className="truncate pl-6 text-xs text-muted-foreground">{shortPath(h.path)}</div>
                  {h.snippet && (
                    <div className="line-clamp-2 pl-6 text-xs">
                      <Highlighted text={h.snippet} ranges={h.highlights} />
                    </div>
                  )}
                </Command.Item>
              ))}
              {q.trim() && total > shown.length && (
                <Command.Item
                  value="__all"
                  onSelect={() => go(`/search?q=${encodeURIComponent(q)}${catQuery()}`)}
                  className="cursor-pointer rounded-md px-2 py-2 text-sm text-muted-foreground data-[selected=true]:bg-muted"
                >
                  전체 결과 {total.toLocaleString()}건 보기 (필터 사용) →
                </Command.Item>
              )}
            </Command.List>
          </Command>
        </div>
      )}
    </>
  );
}
