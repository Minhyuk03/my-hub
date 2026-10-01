"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addFigmaTarget } from "./figma-actions";

export function FigmaTargetForm() {
  const [state, action, pending] = useActionState(addFigmaTarget, null);
  return (
    <form action={action} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input name="target" placeholder="https://www.figma.com/files/team/… 또는 /files/project/…" className="h-8 max-w-md" />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "확인 중…" : "가져오기"}
        </Button>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" name="fetchText" />
        파일 내용 텍스트(페이지·프레임 이름, 글자)도 가져오기 — Figma 요청 한도를 쓰므로 하루 20개까지
      </label>
      {state && <p className={state.ok ? "text-sm text-green-700 dark:text-green-400" : "text-sm text-destructive"}>{state.message}</p>}
    </form>
  );
}
