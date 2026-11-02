"use client";

import { Command } from "cmdk";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Highlighted, SourceIcon, StateBadge } from "@/components/hub-ui";
import { relTime, shortPath } from "@/lib/format";
import type { SearchHit } from "@/server/search/query";
import { readVisits, type Visit } from "@/lib/recent-visits";
import { savedCategories } from "./category-filter";

/** ⌘K 로 바로 갈 수 있는 화면 */
const PAGES = [
  { href: "/", label: "자기소개 · 포트폴리오" },
  { href: "/hub", label: "허브 · 파일 탐색" },
  { href: "/search", label: "검색" },
  { href: "/recent", label: "최근 수정" },
  { href: "/projects", label: "PARA · 프로젝트" },
  { href: "/graph", label: "그래프" },
  { href: "/chat", label: "AI 채팅" },
  { href: "/ai-code", label: "AI 코드" },
  { href: "/ai", label: "AI 정리" },
  { href: "/duplicates", label: "중복 파일" },
  { href: "/status", label: "동기화 상태" },
  { href: "/settings", label: "설정" },
];

/** 검색 화면에서 고른 분류(기억해 둔 것)를 ⌘K 검색에도 쓴다 */
const catQuery = () => (savedCategories() ?? []).map((c) => `&cat=${c}`).join("");

/** 상단 검색창 + ⌘K 어디서든 열리는 검색 */
export function SearchPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 검색어가 없을 때 보여 줄 것: 이 브라우저에서 최근 연 항목, 최근 수정한 항목
  const [recent, setRecent] = useState<SearchHit[]>([]);
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
    if (!open) return;
    fetch(`/api/search?recent=1&limit=6${catQuery()}`)
      .then((r) => (r.headers.get("content-type")?.includes("json") ? r.json() : null))
      .then((r: { hits: SearchHit[] } | null) => setRecent(r?.hits ?? []))
      .catch(() => setRecent([]));
  }, [open]);

  useEffect(() => {
    if (!q.trim()) return;
    const my = ++seq.current;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=15${catQuery()}`);
        // 잠금이 풀려 있지 않으면 서버가 JSON 대신 잠금 화면(HTML)을 돌려준다
        if (!res.headers.get("content-type")?.includes("json")) throw new Error("잠금이 풀려 있지 않습니다. 새로 고침해 패스코드를 넣어 주세요.");
        if (!res.ok) throw new Error(`서버 오류 ${res.status}`);
        const r = (await res.json()) as { hits: SearchHit[]; total: number };
        if (my === seq.current) {
          setHits(r.hits);
          setTotal(r.total);
          setError(null);
        }
      } catch (e) {
        if (my === seq.current) {
          setHits([]);
          setTotal(0);
          setError((e as Error).message);
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
  const typed = q.trim().toLowerCase();
  const pages = typed ? PAGES.filter((p) => p.label.toLowerCase().includes(typed)) : PAGES;
  // 창이 열려 있을 때만 읽는다 (작은 목록이라 렌더마다 읽어도 가볍다)
  const visits: Visit[] = open ? readVisits() : [];
  const visitIds = new Set(visits.map((v) => v.id));
  const group = "px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1";
  const pageItems = (
    <Command.Group heading="이동" className={group}>
      {pages.map((p) => (
        <Command.Item key={p.href} value={`page:${p.href}`} onSelect={() => go(p.href)} className="cursor-pointer rounded-md px-2 py-1.5 text-sm text-foreground data-[selected=true]:bg-muted">
          {p.label}
        </Command.Item>
      ))}
    </Command.Group>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-[11px] uppercase tracking-[0.25em] opacity-70 hover:bg-current/10 hover:opacity-100"
        aria-label="검색 (⌘K)"
      >
        <Search className="size-4" />
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden rounded-sm border border-current/30 px-1 text-[10px] tracking-normal lg:inline">⌘K</kbd>
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
              {!typed && visits.length > 0 && (
                <Command.Group heading="최근 연 항목" className={group}>
                  {visits.map((v) => (
                    <Command.Item key={v.id} value={`visit:${v.id}`} onSelect={() => go(`/items/${v.id}`)} className="cursor-pointer rounded-md px-2 py-1.5 text-foreground data-[selected=true]:bg-muted">
                      <div className="flex items-center gap-2">
                        <SourceIcon kind={v.sourceKind} />
                        <span className="truncate text-sm font-medium">{v.title}</span>
                        <span className="ml-auto truncate text-xs font-normal text-muted-foreground">{shortPath(v.path)}</span>
                      </div>
                    </Command.Item>
                  ))}
                </Command.Group>
              )}
              {!typed && recent.some((h) => !visitIds.has(h.id)) && (
                <Command.Group heading="최근 수정" className={group}>
                  {recent
                    .filter((h) => !visitIds.has(h.id))
                    .map((h) => (
                      <Command.Item key={h.id} value={`recent:${h.id}`} onSelect={() => go(`/items/${h.id}`)} className="cursor-pointer rounded-md px-2 py-1.5 text-foreground data-[selected=true]:bg-muted">
                        <div className="flex items-center gap-2">
                          <SourceIcon kind={h.sourceKind} />
                          <span className="truncate text-sm font-medium">{h.title}</span>
                          <span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground">{relTime(h.modifiedAt)}</span>
                        </div>
                      </Command.Item>
                    ))}
                </Command.Group>
              )}
              {typed && pages.length > 0 && pageItems}
              {q.trim() && error && <p className="p-4 text-sm text-destructive">검색하지 못했습니다: {error}</p>}
              {q.trim() && !loading && !error && !shown.length && !pages.length && <Command.Empty className="p-4 text-sm text-muted-foreground">결과가 없습니다.</Command.Empty>}
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
              {!typed && pageItems}
            </Command.List>
          </Command>
        </div>
      )}
    </>
  );
}
