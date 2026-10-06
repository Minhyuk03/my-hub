"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type ForceGraphType from "force-graph";
import type { GraphLink, GraphNode } from "@/server/graph";

type FGNode = GraphNode & { x?: number; y?: number };
type FGLink = Omit<GraphLink, "source" | "target"> & { source: string | FGNode; target: string | FGNode };
type Data = { nodes: FGNode[]; links: FGLink[]; stats: { notes: number; links: number; tags: number; suggested: number } };

export type GraphOptionsState = {
  tags: boolean;
  files: boolean;
  orphans: boolean;
  /** 태그 있는 모든 파일 */
  all: boolean;
  /** AI 제안 태그 (점선) */
  suggested: boolean;
  color: "folder" | "tag" | "source";
  project: string;
};

// 밝은 화면·어두운 화면 모두에서 구분되는 색
const PALETTE = ["#22c55e", "#3b82f6", "#f59e0b", "#ec4899", "#a855f7", "#14b8a6", "#ef4444", "#84cc16", "#06b6d4", "#f97316"];
const idOf = (x: string | FGNode) => (typeof x === "string" ? x : x.id);

export function GraphView({ opts, reloadKey }: { opts: GraphOptionsState; reloadKey: number }) {
  const box = useRef<HTMLDivElement>(null);
  const fg = useRef<ForceGraphType<FGNode, FGLink> | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [q, setQ] = useState("");
  const [dark, setDark] = useState(true);
  const hover = useRef<FGNode | null>(null);
  // 점들이 멈추면 라이브러리가 다시 그리기를 쉬므로, 마우스를 올리는 등 강조가 바뀔 때 잠깐 다시 그리게 한다
  const redrawTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const kick = useCallback(() => {
    const g = fg.current;
    if (!g) return;
    g.autoPauseRedraw(false);
    if (redrawTimer.current) clearTimeout(redrawTimer.current);
    redrawTimer.current = setTimeout(() => fg.current?.autoPauseRedraw(true), 300);
  }, []);
  const router = useRouter();

  // 데이터 불러오기
  useEffect(() => {
    const p = new URLSearchParams({
      tags: opts.tags ? "1" : "0",
      files: opts.files ? "1" : "0",
      orphans: opts.orphans ? "1" : "0",
      all: opts.all ? "1" : "0",
      suggested: opts.suggested ? "1" : "0",
      color: opts.color,
    });
    if (opts.project) p.set("project", opts.project);
    let alive = true;
    fetch(`/api/graph?${p}`)
      .then((r) => r.json())
      .then((d: Data) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [opts, reloadKey]);

  // 라이트/다크 감지
  useEffect(() => {
    const read = () => setDark(document.documentElement.classList.contains("dark"));
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);

  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of data?.nodes ?? []) if (n.type === "note") counts.set(n.group, (counts.get(n.group) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([g], i) => [g, PALETTE[i % PALETTE.length]] as const);
  }, [data]);
  const colorOf = useMemo(() => new Map(groups), [groups]);

  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of data?.links ?? []) {
      const a = idOf(l.source);
      const b = idOf(l.target);
      if (!m.has(a)) m.set(a, new Set());
      if (!m.has(b)) m.set(b, new Set());
      m.get(a)!.add(b);
      m.get(b)!.add(a);
    }
    return m;
  }, [data]);

  // 그래프 그리기
  useEffect(() => {
    if (!box.current || !data) return;
    let disposed = false;
    let ro: ResizeObserver | null = null;
    (async () => {
      const ForceGraph = (await import("force-graph")).default;
      if (disposed || !box.current) return;
      const fgColor = dark ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.8)";
      const dim = dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)";
      const linkColor = dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.12)";
      const g: ForceGraphType<FGNode, FGLink> = fg.current ?? new ForceGraph<FGNode, FGLink>(box.current);
      fg.current = g;
      const radius = (n: FGNode) => (n.type === "tag" ? 2.5 : 1.5) + Math.min(Math.sqrt(n.degree) * 0.7, 9);
      const active = (n: FGNode) => {
        const h = hover.current;
        return !h || h.id === n.id || neighbors.get(h.id)?.has(n.id);
      };
      g.width(box.current.clientWidth)
        .height(box.current.clientHeight)
        .backgroundColor("rgba(0,0,0,0)")
        .nodeRelSize(1)
        .linkColor((l) => {
          const h = hover.current;
          if (h && (idOf(l.source) === h.id || idOf(l.target) === h.id)) return dark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.5)";
          return linkColor;
        })
        // AI 제안 태그는 점선
        .linkLineDash((l) => (l.kind === "suggested" ? [2, 2] : null))
        .linkWidth((l) => (hover.current && (idOf(l.source) === hover.current.id || idOf(l.target) === hover.current.id) ? 1.5 : 0.6))
        .nodeCanvasObject((n, ctx, scale) => {
          const r = radius(n);
          const on = active(n);
          ctx.beginPath();
          // 노트는 동그라미, 노트가 아닌 문서(Notion·PDF 등)는 네모
          if (n.fileKind) ctx.rect(n.x! - r * 0.9, n.y! - r * 0.9, r * 1.8, r * 1.8);
          else ctx.arc(n.x!, n.y!, r, 0, 2 * Math.PI);
          ctx.fillStyle = !on ? dim : n.type === "tag" ? (dark ? "#e5e7eb" : "#6b7280") : n.type === "file" ? (dark ? "#9ca3af" : "#9ca3af") : (colorOf.get(n.group) ?? "#9ca3af");
          ctx.fill();
          if (n.type === "tag" && n.emoji && on) {
            ctx.font = `${Math.max(r * 1.6, 4)}px sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(n.emoji, n.x!, n.y!);
          }
          // 확대했거나 마우스를 올린 주변 노드만 이름 표시 (Obsidian 과 비슷하게)
          const showLabel = scale > 2.5 || (hover.current != null && on) || (scale > 1.2 && n.degree > 15);
          if (showLabel) {
            const fs = Math.max(11 / scale, 1.5);
            ctx.font = `${fs}px -apple-system, "Apple SD Gothic Neo", sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillStyle = on ? fgColor : dim;
            const label = n.type === "tag" && n.emoji ? `${n.emoji} ${n.label}` : n.label;
            ctx.fillText(label.length > 30 ? label.slice(0, 29) + "…" : label, n.x!, n.y! + r + 1);
          }
        })
        .nodePointerAreaPaint((n, color, ctx) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(n.x!, n.y!, radius(n) + 2, 0, 2 * Math.PI);
          ctx.fill();
        })
        .onNodeHover((n) => {
          hover.current = n ?? null;
          box.current!.style.cursor = n ? "pointer" : "grab";
          kick();
        })
        .onNodeClick((n) => {
          if (n.type === "tag") router.push(`/search?q=${encodeURIComponent(n.tag!)}&tag=${encodeURIComponent(n.tag!)}`);
          else if (n.itemId) router.push(`/items/${n.itemId}`);
        })
        .cooldownTicks(200)
        .graphData({ nodes: data.nodes.map((n) => ({ ...n })), links: data.links.map((l) => ({ ...l })) });
      // 점끼리 더 밀어내고 연결선은 적당히 길게 (Obsidian 과 비슷한 퍼짐)
      g.d3Force("charge")?.strength?.(-60);
      g.d3Force("link")?.distance?.(28);
      g.onEngineStop(() => {});
      setTimeout(() => !disposed && g.zoomToFit(600, 40), 800);
      ro = new ResizeObserver(() => box.current && g.width(box.current.clientWidth).height(box.current.clientHeight));
      ro.observe(box.current);
    })();
    return () => {
      disposed = true;
      ro?.disconnect();
    };
  }, [data, dark, colorOf, neighbors, router, kick]);

  useEffect(
    () => () => {
      fg.current?._destructor();
      fg.current = null;
    },
    [],
  );

  const find = useCallback(() => {
    const g = fg.current;
    if (!g || !q.trim()) return;
    const t = q.trim().normalize("NFC").toLowerCase();
    const n = (g.graphData().nodes as FGNode[]).find((x) => x.label.toLowerCase().includes(t));
    if (n && n.x != null) {
      hover.current = n;
      kick();
      g.centerAt(n.x, n.y, 600);
      g.zoom(4, 600);
    }
  }, [q, kick]);

  return (
    <div className="relative h-full w-full">
      <div ref={box} className="absolute inset-0" />
      <div className="absolute left-3 top-3 flex items-center gap-2 rounded-md border bg-background/80 px-2 py-1 backdrop-blur">
        <Search className="size-4 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && find()}
          placeholder="노트 찾기"
          className="w-40 bg-transparent text-sm outline-none"
        />
      </div>
      <div className="absolute bottom-3 left-3 max-w-[60%] space-y-1 rounded-md border bg-background/80 px-3 py-2 text-xs backdrop-blur">
        {data ? (
          <p className="text-muted-foreground">
            {opts.all ? "문서" : "노트"} {data.stats.notes.toLocaleString()} · 연결 {data.stats.links.toLocaleString()}
            {opts.tags && ` · 태그 ${data.stats.tags}`}
            {opts.suggested && ` · AI 제안 ${data.stats.suggested}개(점선)`}
          </p>
        ) : (
          <p className="text-muted-foreground">불러오는 중…</p>
        )}
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {groups.slice(0, 10).map(([g, c]) => (
            <span key={g} className="flex max-w-48 items-center gap-1" title={g}>
              <span className="inline-block size-2 shrink-0 rounded-full" style={{ background: c }} />
              <span className="truncate">{g}</span>
            </span>
          ))}
        </div>
      </div>
      {data && !data.nodes.length && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
          표시할 연결이 없습니다. 노트 본문이 색인되어야 [[링크]]와 태그가 보입니다.
        </div>
      )}
    </div>
  );
}
