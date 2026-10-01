"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { acceptTags, rejectAi } from "./actions";

/** AI 가 제안한 태그를 골라 수락한다 (기본은 모두 선택) */
export function TagChips({ id, tags, emoji }: { id: number; tags: string[]; emoji: Record<string, string> }) {
  const [sel, setSel] = useState<string[]>(tags);
  const [pending, start] = useTransition();
  const toggle = (t: string) => setSel((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => toggle(t)}
          className={`rounded-full border px-2 py-0.5 text-xs ${sel.includes(t) ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground line-through"}`}
        >
          {emoji[t.split("/")[0]] ? `${emoji[t.split("/")[0]]} ` : ""}#{t}
        </button>
      ))}
      {!tags.length && <span className="text-xs text-muted-foreground">새로 붙일 태그 없음</span>}
      <Button size="sm" className="h-6 px-2 text-xs" disabled={pending || (!sel.length && tags.length > 0)} onClick={() => start(() => acceptTags(id, sel))}>
        {tags.length ? "수락" : "확인"}
      </Button>
      <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={pending} onClick={() => start(() => rejectAi([id]))}>
        거절
      </Button>
    </div>
  );
}
