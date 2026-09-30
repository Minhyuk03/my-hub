"use client";

import { useState, useTransition } from "react";
import { SourceIcon } from "@/components/hub-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { shortPath } from "@/lib/format";
import { linkFolderAction, searchFoldersAction } from "../actions";

type Folder = Awaited<ReturnType<typeof searchFoldersAction>>[number];

/** 인덱싱된 폴더를 이름으로 찾아 프로젝트에 연결한다 */
export function FolderLinker({ projectId }: { projectId: number }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Folder[]>([]);
  const [sub, setSub] = useState(true);
  const [pending, start] = useTransition();

  const find = () => start(async () => setResults(await searchFoldersAction(q)));
  const link = (id: number) =>
    start(async () => {
      await linkFolderAction(projectId, id, sub);
      setResults([]);
      setQ("");
    });

  return (
    <div className="space-y-2 pt-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          find();
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="폴더 이름으로 찾기" className="h-8" />
        <Button type="submit" size="sm" variant="outline" disabled={pending || !q.trim()}>
          찾기
        </Button>
      </form>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={sub} onChange={(e) => setSub(e.target.checked)} />
        하위 폴더 포함
      </label>
      {results.length > 0 && (
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {results.map((f) => (
            <li key={f.id}>
              <button type="button" onClick={() => link(f.id)} disabled={pending} className="w-full rounded px-2 py-1 text-left hover:bg-muted">
                <span className="flex items-center gap-2">
                  <SourceIcon kind={f.sourceKind} />
                  <span className="truncate font-medium">{f.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">연결</span>
                </span>
                <span className="block truncate text-xs text-muted-foreground">{shortPath(f.path)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!pending && q && results.length === 0 && <p className="text-xs text-muted-foreground">찾기를 누르세요. 인덱싱된 폴더만 나옵니다.</p>}
    </div>
  );
}
