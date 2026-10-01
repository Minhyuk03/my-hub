import Link from "next/link";
import { connection } from "next/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fullDate } from "@/lib/format";
import { externalCountToday } from "@/server/chat/gateway";
import { externalLogList } from "@/server/chat/queries";
import { getDb } from "@/server/db";
import { getSettings } from "@/server/settings";

const STATUS: Record<string, { label: string; cls: string }> = {
  ok: { label: "보냄", cls: "text-green-700 dark:text-green-400" },
  sending: { label: "보내는 중", cls: "text-muted-foreground" },
  error: { label: "실패", cls: "text-destructive" },
  blocked: { label: "막음", cls: "text-amber-700 dark:text-amber-400" },
};
const PROVIDER: Record<string, string> = { claude: "Claude", openai: "ChatGPT" };

export default async function ExternalLogPage() {
  await connection();
  const db = getDb();
  const rows = externalLogList(db);
  const s = getSettings(db);
  const tokens = rows.reduce((n, r) => n + (r.inputTokens ?? 0) + (r.outputTokens ?? 0), 0);
  return (
    <div className="space-y-4">
      <div>
        <Link href="/chat" className="text-sm text-muted-foreground hover:text-foreground">
          ← AI 채팅
        </Link>
        <h1 className="mt-1 text-xl font-semibold">외부 전송 내역</h1>
        <p className="text-sm text-muted-foreground">
          Claude·ChatGPT 로 보낸 요청마다 어떤 문서·조각을 보냈는지 기록합니다. 로컬 AI 는 외부로 보내지 않으므로 여기에 없습니다.
          오늘 {externalCountToday(db)} / {s.chatDailyExternalLimit}회 · 최근 {rows.length}건 토큰 {tokens.toLocaleString()}
        </p>
      </div>
      {rows.length === 0 && <p className="text-sm text-muted-foreground">아직 외부로 보낸 요청이 없습니다.</p>}
      {rows.map((r) => (
        <Card key={r.id} size="sm">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
              <span className={STATUS[r.status]?.cls}>{STATUS[r.status]?.label ?? r.status}</span>
              <span>
                {PROVIDER[r.provider]} · {r.model}
              </span>
              <span className="font-normal text-muted-foreground">{fullDate(r.createdAt)}</span>
              {r.threadId ? (
                <Link href={`/chat?t=${r.threadId}`} className="font-normal text-primary hover:underline">
                  대화 보기
                </Link>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>
              <span className="text-muted-foreground">질문 </span>
              {r.question}
            </p>
            <p className="text-muted-foreground">
              문서 {r.items.length}개 · 조각 {r.chunkIds.length}개 · 이전 대화 {r.historyCount / 2}쌍 · {r.chars.toLocaleString()}자
              {r.inputTokens != null && ` · 토큰 입력 ${r.inputTokens.toLocaleString()} / 출력 ${(r.outputTokens ?? 0).toLocaleString()}`}
            </p>
            {r.items.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {r.items.map((it) => (
                  <Link key={it.id} href={`/items/${it.id}`} className="max-w-60 truncate rounded border px-2 py-0.5 text-xs hover:bg-muted">
                    {it.title}
                  </Link>
                ))}
              </div>
            )}
            {r.error && <p className="text-xs text-destructive">{r.error}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
