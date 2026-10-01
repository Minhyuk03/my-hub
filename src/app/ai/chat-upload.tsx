"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** claude.ai·ChatGPT 내보내기 파일 올리기 */
export function ChatUpload() {
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        setBusy(true);
        setMsg(null);
        try {
          const r = await fetch("/api/ai-import", { method: "POST", body: fd }).then((r) => r.json());
          setMsg(r);
          setTimeout(() => router.refresh(), 4000);
        } catch {
          setMsg({ ok: false, message: "올리지 못했습니다." });
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <input type="file" name="file" accept=".zip,.json" required className="text-sm" />
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "올리는 중…" : "가져오기"}
        </Button>
      </div>
      {msg && <p className={msg.ok ? "text-sm text-green-700 dark:text-green-400" : "text-sm text-destructive"}>{msg.message}</p>}
    </form>
  );
}
