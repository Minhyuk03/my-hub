/**
 * 사용자가 AI 를 쓰는 중(채팅·의미 검색)이면 워커의 백그라운드 AI 정리를 잠시 쉬게 한다.
 * 16GB Mac 에서 모델이 서로 GPU·메모리를 다투지 않게 하려는 것. 키는 runtime "chat_active" (예전 이름 유지)
 */
import { eq } from "drizzle-orm";
import type { Db } from "../db";
import { runtime } from "../db/schema";

export function markForeground(db: Db, ms: number, now = Date.now()) {
  const cur = db.select().from(runtime).where(eq(runtime.key, "chat_active")).get()?.value as { until?: number } | undefined;
  const until = Math.max(cur?.until ?? 0, now + ms);
  if (cur?.until && cur.until - now > ms - 10_000) return; // 방금 표시했으면 다시 쓰지 않는다
  db.insert(runtime).values({ key: "chat_active", value: { until }, updatedAt: now }).onConflictDoUpdate({ target: runtime.key, set: { value: { until }, updatedAt: now } }).run();
}
