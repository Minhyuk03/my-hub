"use server";

import { refresh } from "next/cache";
import { getDb } from "@/server/db";
import { setSetting } from "@/server/settings";
import { applyTagAliases, parseAliasLines } from "@/server/tags";

/** 태그 합치기 규칙 저장 → 이미 저장된 태그도 바로 옮긴다. 규칙을 지운 태그는 다음 다시 색인 때 원래 이름으로 돌아온다 */
export async function saveTagAliases(form: FormData) {
  const db = getDb();
  const aliases = parseAliasLines(String(form.get("aliases") ?? ""));
  setSetting(db, "tagAliases", aliases);
  applyTagAliases(db, aliases);
  refresh();
}
