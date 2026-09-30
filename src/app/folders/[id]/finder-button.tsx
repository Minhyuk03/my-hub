"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { openFolderInFinder } from "./actions";

export function FinderButton({ id }: { id: number }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  return (
    <>
      <Button variant="outline" size="sm" disabled={pending} onClick={() => start(async () => setErr((await openFolderInFinder(id)).message))}>
        Finder에서 열기
      </Button>
      {err && <span className="text-sm text-destructive">{err}</span>}
    </>
  );
}
