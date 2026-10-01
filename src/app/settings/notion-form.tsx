"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addNotionRoot } from "./notion-actions";

export function NotionRootForm({ defaultPage }: { defaultPage: string }) {
  const [state, action, pending] = useActionState(addNotionRoot, null);
  return (
    <form action={action} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input name="page" defaultValue={defaultPage} placeholder="https://www.notion.so/… 또는 페이지 ID" className="h-8 max-w-md" />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "확인 중…" : "이 페이지 가져오기"}
        </Button>
      </div>
      {state && <p className={state.ok ? "text-sm text-green-700 dark:text-green-400" : "text-sm text-destructive"}>{state.message}</p>}
    </form>
  );
}
