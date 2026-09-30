"use server";

import fs from "node:fs";
import path from "node:path";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { DATA_DIR } from "@/lib/config";
import { getDb } from "@/server/db";
import { bookmarkGroups, bookmarks, shortcuts } from "@/server/db/schema";
import {
  addBookmark,
  addGroup,
  addTile,
  BG_EXT,
  deleteBookmark,
  deleteGroup,
  deleteTile,
  importChromeBar,
  move,
  parseBookmarkHtml,
  readChromeBar,
  renameGroup,
} from "@/server/home";
import { isLocalRequest } from "@/server/http/local";
import { getSettings, setSetting } from "@/server/settings";

const back = (msg?: string, hash = "") => redirect(`/home/edit${msg ? `?msg=${encodeURIComponent(msg)}` : ""}${hash}`);

async function attempt(fn: () => void, hash: string) {
  let err = "";
  try {
    fn();
  } catch (e) {
    err = (e as Error).message;
  }
  back(err || undefined, hash);
}

export async function addGroupAction(form: FormData) {
  await attempt(() => addGroup(getDb(), String(form.get("name") ?? "")), "#bookmarks");
}
export async function renameGroupAction(id: number, form: FormData) {
  renameGroup(getDb(), id, String(form.get("name") ?? ""));
  refresh();
}
export async function deleteGroupAction(id: number) {
  deleteGroup(getDb(), id);
  refresh();
}
export async function addBookmarkAction(form: FormData) {
  const g = Number(form.get("group")) || null;
  await attempt(() => addBookmark(getDb(), g, String(form.get("title") ?? ""), String(form.get("url") ?? "")), "#bookmarks");
}
export async function deleteBookmarkAction(id: number) {
  deleteBookmark(getDb(), id);
  refresh();
}
export async function moveAction(kind: "bookmark" | "group" | "tile", id: number, dir: -1 | 1) {
  move(getDb(), kind === "bookmark" ? bookmarks : kind === "group" ? bookmarkGroups : shortcuts, id, dir);
  refresh();
}

/** Chrome 북마크 바 가져오기 (Mac mini 의 Chrome 파일을 읽으므로 본인 접속에서만) */
export async function importChromeAction() {
  if (!isLocalRequest(await headers())) back("Mac mini에서 직접 접속한 경우에만 가져올 수 있습니다.", "#bookmarks");
  const bar = readChromeBar();
  if (!bar) back("Chrome 북마크 파일을 찾지 못했습니다.", "#bookmarks");
  const n = importChromeBar(getDb(), bar!);
  back(`Chrome 북마크 ${n}개를 가져왔습니다.`, "#bookmarks");
}

/** 브라우저에서 내보낸 북마크 HTML 파일 가져오기 (다른 기기의 Chrome 도 가능) */
export async function importBookmarkFileAction(form: FormData) {
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) back("파일을 선택하세요.", "#bookmarks");
  const f = file as File;
  if (f.size > 20 * 1024 * 1024) back("파일이 너무 큽니다.", "#bookmarks");
  const bar = parseBookmarkHtml(await f.text());
  if (!bar.root.length && !bar.groups.length) back("북마크를 찾지 못했습니다. 브라우저의 '북마크 내보내기' HTML 파일인지 확인하세요.", "#bookmarks");
  const n = importChromeBar(getDb(), bar);
  back(`북마크 ${n}개를 가져왔습니다. (폴더 ${bar.groups.length}개)`, "#bookmarks");
}

export async function addTileAction(form: FormData) {
  const kind = String(form.get("kind")) as "folder" | "project" | "url";
  await attempt(() => addTile(getDb(), kind, String(form.get("target") ?? ""), String(form.get("title") ?? "")), "#tiles");
}
export async function addFolderTile(folderId: number) {
  addTile(getDb(), "folder", String(folderId));
  refresh();
}
export async function deleteTileAction(id: number) {
  deleteTile(getDb(), id);
  refresh();
}

const MAX_BG = 15 * 1024 * 1024;

export async function uploadBackground(form: FormData) {
  const file = form.get("image");
  if (!(file instanceof File) || !file.size) back("이미지를 선택하세요.", "#background");
  const f = file as File;
  const ext = path.extname(f.name).slice(1).toLowerCase();
  if (!BG_EXT.includes(ext) || !f.type.startsWith("image/")) back("jpg, png, webp, gif 이미지만 쓸 수 있습니다.", "#background");
  if (f.size > MAX_BG) back("15MB 이하 이미지만 쓸 수 있습니다.", "#background");
  const db = getDb();
  const name = `home-bg-${Date.now()}.${ext}`;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, name), Buffer.from(await f.arrayBuffer()));
  const old = getSettings(db).homeBackground;
  setSetting(db, "homeBackground", name);
  if (old && /^home-bg-\d+\.[a-z]+$/.test(old)) fs.rmSync(path.join(DATA_DIR, old), { force: true });
  back("배경을 바꿨습니다.", "#background");
}

export async function resetBackground() {
  const db = getDb();
  const old = getSettings(db).homeBackground;
  setSetting(db, "homeBackground", "");
  if (old && /^home-bg-\d+\.[a-z]+$/.test(old)) fs.rmSync(path.join(DATA_DIR, old), { force: true });
  back("기본 배경으로 되돌렸습니다.", "#background");
}
