import { BookOpen, Cloud, GitBranch, MessagesSquare, PenTool, FileCode, FileImage, FileText, Folder, HardDrive, NotebookPen, Triangle } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { displayState, SOURCE_KIND_LABEL, SOURCE_STATUS_LABEL } from "@/lib/labels";
import { relTime, shortPath } from "@/lib/format";
import { cn } from "@/lib/utils";

export function SourceIcon({ kind, className }: { kind: string; className?: string }) {
  const Icon = kind === "external" ? HardDrive : kind === "icloud" ? Cloud : kind === "obsidian" ? NotebookPen : kind === "gdrive" ? Triangle : kind === "notion" ? BookOpen : kind === "github" ? GitBranch : kind === "figma" ? PenTool : kind === "ai" ? MessagesSquare : Folder;
  return (
    <span title={SOURCE_KIND_LABEL[kind] ?? kind}>
      <Icon className={cn("size-4 shrink-0 text-muted-foreground", className)} aria-label={SOURCE_KIND_LABEL[kind] ?? kind} />
    </span>
  );
}

export function KindIcon({ kind }: { kind: string }) {
  const Icon = kind === "code" ? FileCode : kind === "image" ? FileImage : FileText;
  return <Icon className="size-4 shrink-0 text-muted-foreground" />;
}

export function StateBadge({ state, sourceStatus, noContentReason }: { state: string; sourceStatus: string; noContentReason?: string | null }) {
  const d = displayState(state, sourceStatus, noContentReason);
  if (d.tone === "ok") return null;
  return (
    <Badge variant={d.tone === "bad" ? "destructive" : "outline"} className="shrink-0 font-normal">
      {d.label}
    </Badge>
  );
}

export function SourceStatusBadge({ status }: { status: string }) {
  const variant = status === "ok" ? "secondary" : status === "syncing" ? "outline" : "destructive";
  return <Badge variant={variant}>{SOURCE_STATUS_LABEL[status] ?? status}</Badge>;
}

/** 하이라이트 위치에 맞춰 <mark> 로 감싼다 */
export function Highlighted({ text, ranges }: { text: string; ranges: [number, number][] }) {
  const parts: React.ReactNode[] = [];
  let pos = 0;
  ranges.forEach(([s, e], i) => {
    if (s > pos) parts.push(text.slice(pos, s));
    parts.push(
      <mark key={i} className="rounded-sm bg-yellow-200 px-0.5 text-foreground dark:bg-yellow-700/60">
        {text.slice(s, e)}
      </mark>,
    );
    pos = e;
  });
  parts.push(text.slice(pos));
  return <>{parts}</>;
}

export type ItemRowData = {
  id: number;
  title: string;
  path: string;
  kind: string;
  state: string;
  modifiedAt: number | null;
  sourceKind: string;
  sourceStatus: string;
  noContentReason?: string | null;
};

export function ItemRow({ item, children }: { item: ItemRowData; children?: React.ReactNode }) {
  return (
    <Link href={`/items/${item.id}`} className="block rounded-md px-2 py-2 hover:bg-muted">
      <div className="flex items-center gap-2">
        <SourceIcon kind={item.sourceKind} />
        <span className="truncate font-medium">{item.title}</span>
        <StateBadge state={item.state} sourceStatus={item.sourceStatus} noContentReason={item.noContentReason} />
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">{relTime(item.modifiedAt)}</span>
      </div>
      <div className="truncate pl-6 text-xs text-muted-foreground">{shortPath(item.path)}</div>
      {children}
    </Link>
  );
}
