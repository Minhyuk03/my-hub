"use server";

import { refresh } from "next/cache";
import { getDb } from "@/server/db";
import { setSetting } from "@/server/settings";

const MODEL = /^[A-Za-z0-9._:\/-]{0,80}$/;

export async function saveChatSettings(form: FormData) {
  const db = getDb();
  for (const k of ["chatLocalModel", "chatClaudeModel", "chatOpenAiModel"] as const) {
    const v = String(form.get(k) ?? "").trim();
    if (MODEL.test(v) && (v || k === "chatOpenAiModel")) setSetting(db, k, v);
  }
  const c = Number(form.get("chatMaxContextChars"));
  if (c >= 2000 && c <= 60000) setSetting(db, "chatMaxContextChars", c);
  const l = Number(form.get("chatDailyExternalLimit"));
  if (l >= 0 && l <= 2000) setSetting(db, "chatDailyExternalLimit", l);
  refresh();
}
