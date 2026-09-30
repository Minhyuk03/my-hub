"use client";

import { ChevronRight, Folder, FolderPlus } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SOURCE_KIND_LABEL } from "@/lib/labels";
import { addSourceAction, createFolderAction, listDir, previewNewFolder, type DirListing, type Shortcut } from "./actions";

type Msg = { ok: boolean; message: string; warnings?: string[] } | null;

export function FolderPicker({ shortcuts }: { shortcuts: Shortcut[] }) {
  const [listing, setListing] = useState<DirListing | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const [newName, setNewName] = useState("");
  const [confirmPath, setConfirmPath] = useState<string | null>(null);

  const open = (p: string) =>
    start(async () => {
      setListing(await listDir(p));
      setConfirmPath(null);
      setNewName("");
      setMsg(null);
    });

  const add = () =>
    listing &&
    start(async () => {
      const r = await addSourceAction(listing.path);
      setMsg(r);
      if (r.ok) setListing(await listDir(listing.path));
    });

  const preview = () =>
    listing &&
    start(async () => {
      const r = await previewNewFolder(listing.path, newName);
      if (r.ok) setConfirmPath(r.path!);
      else setMsg({ ok: false, message: r.error! });
    });

  const create = (alsoAdd: boolean) =>
    listing &&
    start(async () => {
      const r = await createFolderAction(listing.path, newName, alsoAdd);
      setMsg(r);
      setConfirmPath(null);
      if (r.ok) setListing(await listDir(listing.path));
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {shortcuts.map((s) => (
          <Button key={s.path} variant="outline" size="sm" onClick={() => open(s.path)} disabled={pending}>
            {s.label}
          </Button>
        ))}
      </div>

      {listing && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {listing.parent && (
              <Button variant="ghost" size="sm" onClick={() => open(listing.parent!)} disabled={pending}>
                ← 상위
              </Button>
            )}
            <code className="break-all">{listing.path}</code>
          </div>
          {listing.error && <p className="text-sm text-destructive">{listing.error}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={add} disabled={pending || !listing.check.ok}>
              이 폴더를 인덱싱에 추가
            </Button>
            {listing.check.ok ? (
              <span className="text-xs text-muted-foreground">{SOURCE_KIND_LABEL[listing.check.kind!]} 소스로 추가됩니다.</span>
            ) : (
              <span className="text-xs text-destructive">{listing.check.error}</span>
            )}
          </div>
          {listing.check.warnings.map((w) => (
            <p key={w} className="text-xs text-amber-600 dark:text-amber-400">
              ⚠ {w}
            </p>
          ))}

          {msg && (
            <div className={msg.ok ? "text-sm text-green-700 dark:text-green-400" : "text-sm text-destructive"}>
              {msg.message}
              {msg.warnings?.map((w) => (
                <p key={w} className="text-xs">
                  ⚠ {w}
                </p>
              ))}
            </div>
          )}

          {listing.canCreateHere && (
            <div className="space-y-2 rounded-md bg-muted/50 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <FolderPlus className="size-4 text-muted-foreground" />
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="새 폴더 이름" className="h-8 max-w-xs" />
                <Button size="sm" variant="outline" onClick={preview} disabled={pending || !newName.trim()}>
                  새 폴더 만들기…
                </Button>
              </div>
              {confirmPath && (
                <div className="space-y-2 text-sm">
                  <p>
                    아래 경로에 폴더를 만듭니다. 맞습니까?
                    <br />
                    <code className="break-all">{confirmPath}</code>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => create(true)} disabled={pending}>
                      만들고 인덱싱에 추가
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => create(false)} disabled={pending}>
                      만들기만
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmPath(null)}>
                      취소
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          <ul className="max-h-80 overflow-y-auto text-sm">
            {listing.dirs.map((d) => (
              <li key={d.path}>
                <button type="button" onClick={() => open(d.path)} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-muted" disabled={pending}>
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{d.name}</span>
                  <ChevronRight className="ml-auto size-4 text-muted-foreground" />
                </button>
              </li>
            ))}
            {!listing.dirs.length && !listing.error && <li className="px-2 py-1.5 text-muted-foreground">하위 폴더가 없습니다.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
