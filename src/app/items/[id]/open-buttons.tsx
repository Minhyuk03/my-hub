"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { openWithDefault, openWithEditor, revealInFinder, type OpenResult } from "./actions";

export function LocalOpenButtons({ id, hasEditor }: { id: number; hasEditor: boolean }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<OpenResult | null>(null);
  const run = (fn: (id: number) => Promise<OpenResult>) => start(async () => setMsg(await fn(id)));
  return (
    <>
      <Button variant="outline" size="sm" disabled={pending} onClick={() => run(revealInFinder)}>
        Finder에서 보기
      </Button>
      <Button variant="outline" size="sm" disabled={pending} onClick={() => run(openWithDefault)}>
        기본 앱으로 열기
      </Button>
      {hasEditor && (
        <Button variant="outline" size="sm" disabled={pending} onClick={() => run(openWithEditor)}>
          편집기로 열기
        </Button>
      )}
      {msg && !msg.ok && <span className="text-sm text-destructive">{msg.message}</span>}
    </>
  );
}
