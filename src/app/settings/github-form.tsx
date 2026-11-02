"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { addGitHubAccount } from "./github-actions";

export function GitHubImportForm() {
  const [state, action, pending] = useActionState(addGitHubAccount, null);
  return (
    <form action={action} className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="forks" value="0" size="sm" disabled={pending}>
          {pending ? "확인 중…" : "내 저장소 가져오기"}
        </Button>
        <Button type="submit" name="forks" value="1" size="sm" variant="outline" disabled={pending}>
          포크한 저장소도 포함
        </Button>
      </div>
      {state && <p className={state.ok ? "text-sm text-green-700 dark:text-green-400" : "text-sm text-destructive"}>{state.message}</p>}
    </form>
  );
}
