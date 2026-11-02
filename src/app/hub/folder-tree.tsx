"use client";

import { ChevronRight, Folder, FolderOpen } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { SourceIcon } from "@/components/hub-ui";
import type { SourceRoot, TreeNode } from "@/server/browse";

/** 왼쪽 폴더 나무: 소스 → 폴더. 지금 보는 폴더까지는 펼쳐 둔다. 접고 펴는 건 이 화면에서만 */
export function FolderTree({ sources, nodes, current, open: initialOpen }: { sources: SourceRoot[]; nodes: TreeNode[]; current: number | null; open: number[] }) {
  const [open, setOpen] = useState(() => new Set(initialOpen));
  const children = new Map<number, TreeNode[]>();
  for (const n of nodes) if (n.parentId != null) children.set(n.parentId, [...(children.get(n.parentId) ?? []), n]);
  const toggle = (id: number) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const Row = ({ id, label, count, depth, icon }: { id: number; label: string; count: number; depth: number; icon: React.ReactNode }) => {
    const kids = children.get(id) ?? [];
    const isOpen = open.has(id);
    return (
      <li>
        <div
          className={`flex items-center gap-1 rounded-sm pr-1 text-sm ${current === id ? "bg-primary/10 text-foreground" : "text-foreground/80 hover:bg-muted"}`}
          style={{ paddingLeft: depth * 12 }}
        >
          <button
            type="button"
            onClick={() => toggle(id)}
            className={`flex size-6 shrink-0 items-center justify-center rounded-sm hover:bg-muted ${kids.length ? "" : "invisible"}`}
            aria-label={isOpen ? "접기" : "펼치기"}
            aria-expanded={isOpen}
          >
            <ChevronRight className={`size-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`} />
          </button>
          <Link href={`/hub?f=${id}`} className="flex min-w-0 flex-1 items-center gap-1.5 py-1" aria-current={current === id ? "page" : undefined}>
            {icon}
            <span className="truncate">{label}</span>
            <span className="ml-auto shrink-0 pl-1 text-[11px] tabular-nums text-muted-foreground">{count.toLocaleString()}</span>
          </Link>
        </div>
        {isOpen && kids.length > 0 && (
          <ul>
            {kids.map((k) => (
              <Row
                key={k.id}
                id={k.id}
                label={k.name}
                count={k.total}
                depth={depth + 1}
                icon={current === k.id || open.has(k.id) ? <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" /> : <Folder className="size-3.5 shrink-0 text-muted-foreground" />}
              />
            ))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <ul className="space-y-0.5">
      {sources.map((s) =>
        s.rootFolderId ? (
          <Row key={s.id} id={s.rootFolderId} label={s.name} count={s.total} depth={0} icon={<SourceIcon kind={s.kind} className="size-3.5 shrink-0" />} />
        ) : null,
      )}
    </ul>
  );
}
