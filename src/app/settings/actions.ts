"use server";

import fs from "node:fs";
import path from "node:path";
import { refresh } from "next/cache";
import { HOME, PATHS } from "@/lib/config";
import { isMountPoint } from "@/lib/env-check";
import { getDb } from "@/server/db";
import { createSource, enqueue, previewNewSource, removeSource } from "@/server/sources/manage";
import { checkNewFolder, normalizeUserPath, isExcludedFolder, isExcludedName, isExcludedVolume, isInside, volumeRootOf, type SourceCheck } from "@/server/sources/rules";
import { getSettings, setSetting } from "@/server/settings";

export type DirListing = {
  path: string;
  parent: string | null;
  dirs: { name: string; path: string }[];
  check: SourceCheck;
  canCreateHere: boolean;
  error?: string;
};

export type Shortcut = { label: string; path: string };

/** 폴더 선택기의 시작 위치 */
export async function shortcuts(): Promise<Shortcut[]> {
  const list: Shortcut[] = [
    { label: "iCloud Drive", path: PATHS.icloudDrive },
    { label: "문서 (iCloud)", path: path.join(HOME, "Documents") },
    { label: "데스크탑 (iCloud)", path: path.join(HOME, "Desktop") },
    { label: "Obsidian 볼트", path: PATHS.obsidianVault },
  ];
  for (const v of fs.readdirSync("/Volumes")) {
    const p = path.join("/Volumes", v);
    if (!isExcludedVolume(p) && isMountPoint(p)) list.push({ label: `외장 디스크 ${v}`, path: p });
  }
  return list.filter((s) => fs.existsSync(s.path));
}

function browsable(p: string) {
  return (isInside(p, HOME) || isInside(p, "/Volumes")) && !isExcludedVolume(p);
}

export async function listDir(p: string): Promise<DirListing> {
  const db = getDb();
  const s = getSettings(db);
  let real = p;
  try {
    real = fs.realpathSync(p);
  } catch {}
  const check = previewNewSource(db, real);
  const vr = volumeRootOf(real);
  const base: DirListing = {
    path: real,
    parent: real === "/" ? null : path.dirname(real),
    dirs: [],
    check,
    canCreateHere: !!vr && !isExcludedVolume(real) && !isExcludedFolder(real, s.excludedFolders),
  };
  if (!browsable(real)) return { ...base, parent: null, error: "이 위치는 볼 수 없습니다." };
  try {
    base.dirs = fs
      .readdirSync(real, { withFileTypes: true })
      .filter((d) => (d.isDirectory() || d.isSymbolicLink()) && !isExcludedName(d.name, s.excludedPatterns))
      .map((d) => ({ name: d.name.normalize("NFC"), path: path.join(real, d.name) }))
      .filter((d) => {
        try {
          return fs.statSync(d.path).isDirectory() && !isExcludedFolder(d.path, s.excludedFolders) && !isExcludedVolume(d.path);
        } catch {
          return false;
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  } catch {
    base.error = "폴더를 읽을 수 없습니다. (권한 확인)";
  }
  if (base.parent && !browsable(base.parent)) base.parent = null;
  return base;
}

export async function addSourceAction(p: string, name?: string): Promise<{ ok: boolean; message: string; warnings?: string[] }> {
  try {
    const r = createSource(getDb(), p, undefined, name?.trim() || undefined);
    refresh();
    return { ok: true, message: `${r.source.name} 추가됨. 인덱싱을 시작합니다.`, warnings: r.warnings };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function removeSourceAction(id: number) {
  removeSource(getDb(), id);
  refresh();
}

export async function previewNewFolder(parent: string, name: string) {
  return checkNewFolder(parent, name, getSettings(getDb()).excludedFolders);
}

/** 확인을 받은 뒤에만 호출된다. 기존 폴더를 옮기거나 지우지 않는다. */
export async function createFolderAction(parent: string, name: string, alsoAdd: boolean) {
  const c = checkNewFolder(parent, name, getSettings(getDb()).excludedFolders);
  if (!c.ok) return { ok: false, message: c.error! };
  fs.mkdirSync(c.path!); // recursive 아님: 상위 폴더가 이미 있어야 한다
  if (alsoAdd) return addSourceAction(c.path!);
  return { ok: true, message: `${c.path} 폴더를 만들었습니다.` };
}

const lines = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

export async function saveSettings(form: FormData) {
  const db = getDb();
  const s = getSettings(db);
  const num = (k: string, min: number, max: number, def: number) => {
    const n = Number(form.get(k));
    return Number.isFinite(n) && n >= min && n <= max ? n : def;
  };
  const folders = [...new Set(lines(form.get("excludedFolders")).map(normalizeUserPath))];
  // 백업 폴더는 항상 제외
  if (!folders.includes(s.backupDir)) folders.push(s.backupDir);
  setSetting(db, "excludedFolders", folders);
  setSetting(db, "excludedPatterns", lines(form.get("excludedPatterns")));
  setSetting(db, "fullScanIntervalHours", num("fullScanIntervalHours", 1, 168, s.fullScanIntervalHours));
  setSetting(db, "maxExtractMB", num("maxExtractMB", 1, 1024, s.maxExtractMB));
  setSetting(db, "concurrency", num("concurrency", 1, 16, s.concurrency));
  setSetting(db, "deletedRetentionDays", num("deletedRetentionDays", 1, 365, s.deletedRetentionDays));
  setSetting(db, "backupHour", num("backupHour", 0, 23, s.backupHour));
  setSetting(db, "backupKeepDaily", num("backupKeepDaily", 1, 365, s.backupKeepDaily));
  setSetting(db, "backupKeepWeekly", num("backupKeepWeekly", 0, 104, s.backupKeepWeekly));
  const editors: Record<string, string> = {};
  for (const l of lines(form.get("editorByExt"))) {
    const m = l.match(/^\.?([\w]+)\s*=\s*(.+)$/);
    if (m) editors[m[1].toLowerCase()] = m[2].trim();
  }
  setSetting(db, "editorByExt", editors);
  setSetting(db, "synonyms", lines(form.get("synonyms")).filter((l) => l.includes("=")));
  enqueue(db, "settings_changed");
  refresh();
}

/** 홈 가운데 제목 (비우면 기본값) */
export async function saveHomeTitle(form: FormData) {
  const t = String(form.get("homeTitle") ?? "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  setSetting(getDb(), "homeTitle", t || "나의 허브");
  refresh();
}
