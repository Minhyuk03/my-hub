"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { savePasscode } from "./security-actions";

export function PasscodeForm({ isSet }: { isSet: boolean }) {
  const [state, action, pending] = useActionState(savePasscode, null);
  return (
    <form action={action} className="space-y-2">
      <p className="text-sm font-medium">앱 패스코드 {isSet ? "(설정됨 — 새로 입력하면 바뀝니다)" : "(미설정 — 설정해야 외부 접속 가능)"}</p>
      <div className="flex flex-wrap gap-2">
        <Input type="password" name="passcode" placeholder="새 패스코드 (6자 이상)" autoComplete="new-password" className="h-8 w-48" />
        <Input type="password" name="confirm" placeholder="한 번 더" autoComplete="new-password" className="h-8 w-48" />
        <Button type="submit" size="sm" disabled={pending}>
          저장
        </Button>
      </div>
      {state && <p className={state.ok ? "text-sm text-green-700 dark:text-green-400" : "text-sm text-destructive"}>{state.message}</p>}
    </form>
  );
}
