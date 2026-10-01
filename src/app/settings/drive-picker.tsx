"use client";

import { ChevronRight, Folder } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { addDriveFolder, listDriveFolders, type DriveFolder } from "./drive-actions";

type Listing = { id: string; name: string; parent: string | null; folders: DriveFolder[] };

export function DrivePicker() {
  const [l, setL] = useState<Listing | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const open = (id: string) =>
    start(async () => {
      const r = await listDriveFolders(id);
      if (!r.ok) return setMsg({ ok: false, message: r.message ?? "불러오지 못했습니다." });
      setMsg(null);
      setL({ id, name: r.name ?? "", parent: r.parent ?? null, folders: r.folders });
    });
  return (
    <div className="space-y-2">
      {!l && (
        <Button variant="outline" size="sm" onClick={() => open("root")} disabled={pending}>
          내 드라이브에서 폴더 고르기
        </Button>
      )}
      {l && (
        <div className="space-y-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {l.parent && (
              <Button variant="ghost" size="sm" onClick={() => open(l.parent!)} disabled={pending}>
                ← 상위
              </Button>
            )}
            <span className="font-medium">{l.name}</span>
            {l.id !== "root" && (
              <Button size="sm" disabled={pending} onClick={() => start(async () => setMsg(await addDriveFolder(l.id, l.name)))}>
                이 폴더를 인덱싱에 추가
              </Button>
            )}
          </div>
          <ul className="max-h-72 overflow-y-auto text-sm">
            {l.folders.map((f) => (
              <li key={f.id}>
                <button type="button" onClick={() => open(f.id)} disabled={pending} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted">
                  <Folder className="size-4 text-muted-foreground" />
                  <span className="truncate">{f.name}</span>
                  <ChevronRight className="ml-auto size-4 text-muted-foreground" />
                </button>
              </li>
            ))}
            {!l.folders.length && <li className="px-2 py-1.5 text-muted-foreground">하위 폴더가 없습니다.</li>}
          </ul>
        </div>
      )}
      {pending && <p className="text-xs text-muted-foreground">불러오는 중…</p>}
      {msg && <p className={msg.ok ? "text-sm text-green-700 dark:text-green-400" : "text-sm text-destructive"}>{msg.message}</p>}
    </div>
  );
}
