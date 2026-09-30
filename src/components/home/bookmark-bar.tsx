"use client";

import { ChevronDown, Folder, Pencil } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Bm = { id: number; title: string; url: string };
type Group = { id: number; name: string; items: Bm[] };

/** 사이트 아이콘: 사이트의 favicon.ico, 없으면 첫 글자 */
export function SiteIcon({ url, title, size = 16 }: { url: string; title: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  let origin = "";
  try {
    const u = new URL(url);
    if (u.protocol === "http:" || u.protocol === "https:") origin = u.origin;
  } catch {}
  if (!origin || failed) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-sm bg-muted text-[10px] font-semibold uppercase text-muted-foreground"
        style={{ width: size, height: size }}
      >
        {(title || "?").slice(0, 1)}
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`${origin}/favicon.ico`} alt="" width={size} height={size} className="shrink-0 rounded-sm bg-white p-px" onError={() => setFailed(true)} referrerPolicy="no-referrer" />;
}

function GroupMenu({ g }: { g: Group }) {
  // 북마크 바가 가로 스크롤되므로 메뉴는 화면 기준(fixed)으로 띄운다 (바 안에 두면 잘림)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const open = pos != null;
  const ref = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const toggle = () => {
    if (open) return setPos(null);
    const r = btn.current!.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 296)) });
  };
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !menu.current?.contains(e.target as Node)) setPos(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setPos(null);
    const hide = () => setPos(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        ref={btn}
        type="button"
        onClick={toggle}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-foreground/90 hover:bg-foreground/10"
        aria-expanded={open}
      >
        <Folder className="size-4" />
        {g.name}
        <ChevronDown className="size-3 opacity-60" />
      </button>
      {open &&
        createPortal(
        <div
          ref={menu}
          style={{ top: pos.top, left: pos.left }}
          className="fixed z-50 max-h-[70vh] w-72 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl"
        >
          {!g.items.length && <p className="px-2 py-1.5 text-sm text-muted-foreground">비어 있습니다.</p>}
          {g.items.map((b) => (
            <a key={b.id} href={b.url} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted" title={b.url}>
              <SiteIcon url={b.url} title={b.title} />
              <span className="truncate">{b.title}</span>
            </a>
          ))}
        </div>,
          document.body,
        )}
    </div>
  );
}

export function BookmarkBar({ root, groups }: { root: Bm[]; groups: Group[] }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-foreground/10 bg-background/60 px-3 py-1 backdrop-blur [scrollbar-width:none]">
      {groups.map((g) => (
        <GroupMenu key={g.id} g={g} />
      ))}
      {root.map((b) => (
        <a key={b.id} href={b.url} title={b.url} className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm text-foreground/90 hover:bg-foreground/10">
          <SiteIcon url={b.url} title={b.title} />
          <span className="max-w-40 truncate">{b.title}</span>
        </a>
      ))}
      {!groups.length && !root.length && <span className="px-2 py-1 text-sm text-muted-foreground">북마크가 없습니다.</span>}
      <Link href="/home/edit" className="ml-auto flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-foreground/10" title="홈 꾸미기">
        <Pencil className="size-3.5" /> 꾸미기
      </Link>
    </div>
  );
}
