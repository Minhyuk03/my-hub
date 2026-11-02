"use client";

import { FileCode, FileImage, FileText, LayoutGrid, List, NotebookPen, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CoverImage } from "@/components/cover-image";
import { SourceIcon, StateBadge } from "@/components/hub-ui";
import { bytes, relTime } from "@/lib/format";
import type { FileRow } from "@/server/browse";

const CLOUD = new Set(["gdrive", "notion", "github", "figma"]);
const VIEW_KEY = "hub.fileView";

function KindIcon({ kind }: { kind: string }) {
  const cls = "size-4 shrink-0 text-muted-foreground";
  if (kind === "image") return <FileImage className={cls} />;
  if (kind === "code") return <FileCode className={cls} />;
  if (kind === "note") return <NotebookPen className={cls} />;
  return <FileText className={cls} />;
}

/**
 * 가운데 파일 목록: 이 위치 안에서 바로 거르기, 목록/격자 보기(격자는 이 Mac 에 받아져 있는 사진만 작게 보여 줌).
 * 넓은 화면에서는 누르면 오른쪽에 미리보기, 좁은 화면에서는 항목 화면으로.
 */
export function FileList({ rows, selected, itemHref }: { rows: FileRow[]; selected: number | null; itemHref: Record<number, string> }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [view, setView] = useState<"list" | "grid">("list");
  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      if (v === "grid" || v === "list") requestAnimationFrame(() => setView(v));
    } catch {}
  }, []);
  const pick = (v: "list" | "grid") => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };
  const open = (e: React.MouseEvent, id: number) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return; // 새 탭 열기는 그대로
    e.preventDefault();
    if (window.matchMedia("(min-width: 1024px)").matches) router.push(itemHref[id], { scroll: false });
    else router.push(`/items/${id}`);
  };
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = words.length ? rows.filter((r) => words.every((w) => `${r.title} ${r.path}`.toLowerCase().includes(w))) : rows;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label className="flex h-8 flex-1 items-center gap-2 rounded-sm border px-2 text-sm focus-within:ring-2 focus-within:ring-ring/50">
          <Search className="size-3.5 text-muted-foreground" />
          <input id="hub-filter" value={q} onChange={(e) => setQ(e.target.value)} placeholder="이 목록에서 거르기" className="min-w-0 flex-1 bg-transparent outline-none" />
        </label>
        <div className="flex rounded-sm border">
          <button type="button" onClick={() => pick("list")} className={`flex size-8 items-center justify-center ${view === "list" ? "bg-muted" : "text-muted-foreground"}`} aria-label="목록으로 보기" aria-pressed={view === "list"}>
            <List className="size-4" />
          </button>
          <button type="button" onClick={() => pick("grid")} className={`flex size-8 items-center justify-center ${view === "grid" ? "bg-muted" : "text-muted-foreground"}`} aria-label="격자로 보기" aria-pressed={view === "grid"}>
            <LayoutGrid className="size-4" />
          </button>
        </div>
      </div>
      {words.length > 0 && <p className="text-xs text-muted-foreground">{shown.length}개 · 이 화면에 불러온 파일 안에서만 거릅니다</p>}
      {!shown.length && <p className="py-6 text-center text-sm text-muted-foreground">파일이 없습니다.</p>}
      {view === "list" ? (
        <ul className="divide-y">
          {shown.map((r) => (
            <li key={r.id}>
              <Link
                href={itemHref[r.id]}
                onClick={(e) => open(e, r.id)}
                scroll={false}
                className={`flex items-center gap-2 px-2 py-2 text-sm ${selected === r.id ? "bg-primary/10" : "hover:bg-muted"}`}
              >
                <KindIcon kind={r.kind} />
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
                <StateBadge state={r.state} sourceStatus={r.sourceStatus} noContentReason={r.noContentReason} />
                <span className="hidden w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:block">{r.size ? bytes(r.size) : ""}</span>
                <span className="w-20 shrink-0 text-right text-xs text-muted-foreground">{relTime(r.modifiedAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {shown.map((r) => (
            <li key={r.id}>
              <Link href={itemHref[r.id]} onClick={(e) => open(e, r.id)} scroll={false} className={`block rounded-sm border p-1.5 text-xs ${selected === r.id ? "border-primary bg-primary/10" : "hover:bg-muted"}`}>
                {/* 이 Mac 에 받아져 있는 사진만 작게 보여 준다 (iCloud 에만 있는 파일을 열면 내려받기가 시작되므로) */}
                {r.kind === "image" && r.state === "ok" && !CLOUD.has(r.sourceKind) ? (
                  <CoverImage src={`/api/items/${r.id}/file`} className="aspect-square w-full rounded-sm" />
                ) : (
                  <div className="flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-sm bg-muted">
                    <KindIcon kind={r.kind} />
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{r.ext}</span>
                  </div>
                )}
                <p className="mt-1.5 flex items-center gap-1">
                  <SourceIcon kind={r.sourceKind} className="size-3 shrink-0" />
                  <span className="truncate">{r.title}</span>
                </p>
                <p className="text-muted-foreground">{relTime(r.modifiedAt)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
