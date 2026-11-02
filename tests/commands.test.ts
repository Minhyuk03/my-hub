import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { commands } from "@/server/db/schema";
import { enqueueAndWait } from "@/server/sources/manage";
import { testDb } from "./helpers";

describe("화면 → 워커 명령 결과", () => {
  it("워커가 끝내면 결과를 돌려준다", async () => {
    const db = testDb();
    // 가짜 워커: 잠시 뒤 처리
    setTimeout(() => {
      const c = db.select().from(commands).get()!;
      db.update(commands).set({ takenAt: Date.now(), doneAt: Date.now(), result: "오류: 디스크 없음" }).where(eq(commands.id, c.id)).run();
    }, 100);
    expect(await enqueueAndWait(db, "backup", {}, 5_000)).toEqual({ done: true, result: "오류: 디스크 없음" });
  });

  it("워커가 응답하지 않으면 시간이 지나 done=false", async () => {
    const db = testDb();
    expect(await enqueueAndWait(db, "backup", {}, 400)).toEqual({ done: false, result: null });
  });
});
