"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { hideSensitive, unhideSensitive } from "@/server/sensitive";
import { setSetting } from "@/server/settings";
import { enqueue } from "@/server/sources/manage";
import { purgeExcluded } from "@/server/sync/scanner";

/** 폴더·항목 화면의 "민감 정보로 숨기기". 숨긴 뒤에는 그 화면이 없으므로 상위 폴더(없으면 허브)로 간다 */
export async function hideSensitiveAction(kind: "folder" | "item", id: number) {
  if ((kind !== "folder" && kind !== "item") || !Number.isInteger(id)) return;
  const r = hideSensitive(getDb(), { kind, id });
  if (!r.ok) throw new Error(r.message);
  redirect(r.parentFolderId ? `/folders/${r.parentFolderId}` : "/hub");
}

export async function unhideSensitiveAction(p: string) {
  if (typeof p !== "string" || !p) return;
  unhideSensitive(getDb(), p);
  refresh();
}

/** 이름 규칙 낱말 저장: 걸리는 이미지·PDF 는 바로 색인에서 빼고, 규칙에서 뺀 낱말의 파일은 다음 스캔에서 다시 들어온다 */
export async function saveSensitiveWords(form: FormData) {
  const words = [
    ...new Set(
      String(form.get("words") ?? "")
        .split(/[\n,]/)
        .map((w) => w.trim().normalize("NFC"))
        .filter((w) => w.length >= 2),
    ),
  ];
  const db = getDb();
  setSetting(db, "sensitiveNameWords", words);
  purgeExcluded(db);
  enqueue(db, "settings_changed");
  refresh();
}
