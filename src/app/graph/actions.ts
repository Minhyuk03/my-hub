"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { getDb } from "@/server/db";
import { sources } from "@/server/db/schema";
import { setTagEmoji } from "@/server/graph";
import { enqueue } from "@/server/sources/manage";

export async function setTagEmojiAction(tag: string, emoji: string): Promise<{ ok: boolean; message?: string }> {
  try {
    setTagEmoji(getDb(), tag, emoji);
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** 소스의 "텍스트 파일 내려받기" 켜기/끄기. 켜면 다시 확인해 iCloud 에만 있는 노트를 받아 색인한다. */
export async function setDownloadTextAction(sourceId: number, on: boolean) {
  const db = getDb();
  const s = db.select().from(sources).where(eq(sources.id, sourceId)).get();
  if (!s) return;
  db.update(sources)
    .set({ config: { ...(s.config ?? {}), downloadText: on } })
    .where(eq(sources.id, sourceId))
    .run();
  if (on) enqueue(db, "rescan", { sourceId });
  refresh();
}
