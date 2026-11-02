"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { CommandOutcome } from "@/server/sources/manage";

/**
 * 워커에 명령을 보내는 버튼. 누르면 "처리 중…", 끝나면 결과(완료·오류)를 버튼 옆에 보여 준다.
 * action 은 enqueueAndWait 결과를 돌려주는 서버 액션.
 */
export function CommandButton({
  action,
  label,
  doneText = "완료했습니다.",
  showResult = false,
  variant = "outline",
  className = "",
}: {
  action: () => Promise<CommandOutcome>;
  label: string;
  doneText?: string;
  /** 성공했을 때 워커 결과(예: 백업 파일 경로)도 함께 보여 준다 */
  showResult?: boolean;
  variant?: "outline" | "ghost" | "default";
  className?: string;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);

  const run = () =>
    start(async () => {
      setMsg(null);
      try {
        const r = await action();
        if (!r.done) setMsg({ text: "인덱서가 아직 처리하지 않았습니다. 오래 걸리거나 멈춰 있을 수 있습니다 (터미널에서 hub status).", error: true });
        else if (r.result?.startsWith("오류")) setMsg({ text: r.result, error: true });
        else setMsg({ text: showResult && r.result && r.result !== "ok" ? `${doneText} ${r.result}` : doneText, error: false });
      } catch (e) {
        setMsg({ text: `오류: ${(e as Error).message}`, error: true });
      }
      router.refresh();
    });

  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${className}`}>
      <Button type="button" variant={variant} size="sm" disabled={busy} onClick={run}>
        {busy ? "처리 중…" : label}
      </Button>
      {msg && (
        <span role="status" className={`break-all text-xs ${msg.error ? "text-destructive" : "text-muted-foreground"}`}>
          {msg.text}
        </span>
      )}
    </span>
  );
}
