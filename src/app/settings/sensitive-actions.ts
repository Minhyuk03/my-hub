"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { hideSensitive, unhideSensitive } from "@/server/sensitive";

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
