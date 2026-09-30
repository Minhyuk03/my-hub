"use client";

import { useState, useTransition } from "react";
import { SourceIcon } from "@/components/hub-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { shortPath } from "@/lib/format";
import { searchFoldersAction } from "@/app/projects/actions";
import { addFolderTile } from "./actions";

type Folder = Awaited<ReturnType<typeof searchFoldersAction>>[number];

/** 인덱싱된 폴더를 이름으로 찾아 홈 즐겨찾기에 추가 */
export function TileFolderPicker() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Folder[]>([]);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => setResults(await searchFoldersAction(q)));
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="폴더 이름" className="h-8" />
        <Button type="submit" size="sm" variant="outline" disabled={pending || !q.trim()}>
          찾기
        </Button>
      </form>
      {results.length > 0 && (
        <ul className="max-h-56 overflow-y-auto">
          {results.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    await addFolderTile(f.id);
                    setResults([]);
                    setQ("");
                  })
                }
                className="w-full rounded px-2 py-1 text-left hover:bg-muted"
              >
                <span className="flex items-center gap-2 text-sm">
                  <SourceIcon kind={f.sourceKind} />
                  <span className="truncate font-medium">{f.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">추가</span>
                </span>
                <span className="block truncate text-xs text-muted-foreground">{shortPath(f.path)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
