"use server";

import { execFile } from "node:child_process";
import fs from "node:fs";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { refresh } from "next/cache";
import { getDb } from "@/server/db";
import { folders } from "@/server/db/schema";
import { addTile } from "@/server/home";
import { isLocalRequest } from "@/server/http/local";
import { linkFolder } from "@/server/projects";

/** Finder 에서 폴더 열기 (Mac mini 본인 접속에서만) */
export async function openFolderInFinder(id: number): Promise<{ ok: boolean; message: string }> {
  if (!isLocalRequest(await headers())) return { ok: false, message: "Mac mini에서 직접 접속한 경우에만 사용할 수 있습니다." };
  const f = getDb().select().from(folders).where(eq(folders.id, id)).get();
  if (!f || !fs.existsSync(f.path)) return { ok: false, message: "폴더를 찾을 수 없습니다." };
  return new Promise((resolve) => execFile("/usr/bin/open", [f.path], (err) => resolve(err ? { ok: false, message: err.message } : { ok: true, message: "" })));
}

export async function pinFolder(id: number) {
  addTile(getDb(), "folder", String(id));
  refresh();
}

export async function linkFolderToProject(id: number, form: FormData) {
  const pid = Number(form.get("project"));
  if (pid) linkFolder(getDb(), pid, id);
  refresh();
}
