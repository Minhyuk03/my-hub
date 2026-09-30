"use server";

import { execFile } from "node:child_process";
import { headers } from "next/headers";
import { getDb } from "@/server/db";
import { isLocalRequest } from "@/server/http/local";
import { resolveItemFile } from "@/server/items/access";
import { getSettings } from "@/server/settings";

export type OpenResult = { ok: boolean; message: string };

/**
 * Mac mini 에서 프로그램을 실행하는 동작. 서버 본인 접속(localhost)에서만 허용한다.
 * 다른 기기에서 온 요청은 버튼이 숨겨지고, 요청이 와도 여기서 거부한다.
 */
async function runOpen(id: number, mode: "reveal" | "default" | "editor"): Promise<OpenResult> {
  if (!isLocalRequest(await headers())) return { ok: false, message: "Mac mini에서 직접 접속한 경우에만 사용할 수 있습니다." };
  const db = getDb();
  const r = resolveItemFile(db, id);
  if (!r.ok) return { ok: false, message: r.message };
  let args: string[];
  if (mode === "reveal") args = ["-R", r.path];
  else if (mode === "default") args = [r.path];
  else {
    const app = getSettings(db).editorByExt[r.item.item.ext];
    if (!app) return { ok: false, message: `.${r.item.item.ext} 형식의 편집기가 설정되지 않았습니다. 설정에서 지정하세요.` };
    args = ["-a", app, r.path];
  }
  return new Promise((resolve) =>
    execFile("/usr/bin/open", args, (err) => resolve(err ? { ok: false, message: `열기 실패: ${err.message}` } : { ok: true, message: "열었습니다." })),
  );
}

export async function revealInFinder(id: number) {
  return runOpen(id, "reveal");
}
export async function openWithDefault(id: number) {
  return runOpen(id, "default");
}
export async function openWithEditor(id: number) {
  return runOpen(id, "editor");
}
