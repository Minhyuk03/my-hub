import { eq } from "drizzle-orm";
import { DEFAULT_EXCLUDED_FOLDERS, DEFAULT_EXCLUDED_PATTERNS, PATHS } from "@/lib/config";
import type { Db } from "./db";
import { settings } from "./db/schema";

export const DEFAULT_SETTINGS = {
  excludedFolders: DEFAULT_EXCLUDED_FOLDERS as string[],
  excludedPatterns: DEFAULT_EXCLUDED_PATTERNS as string[],
  deletedRetentionDays: 30,
  fullScanIntervalHours: 6,
  maxExtractMB: 50,
  concurrency: 4,
  backupHour: 4,
  backupDir: PATHS.backupDir as string,
  backupKeepDaily: 14,
  backupKeepWeekly: 8,
  /** 확장자별 "편집기로 열기" 앱 이름 (open -a) */
  editorByExt: { md: "Visual Studio Code", ts: "Visual Studio Code", js: "Visual Studio Code", py: "Visual Studio Code" } as Record<string, string>,
};

export type Settings = typeof DEFAULT_SETTINGS;

export function getSettings(db: Db): Settings {
  const rows = db.select().from(settings).all();
  const out = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const r of rows) if (r.key in out) out[r.key] = r.value;
  return out as Settings;
}

export function setSetting<K extends keyof Settings>(db: Db, key: K, value: Settings[K]) {
  const exists = db.select().from(settings).where(eq(settings.key, key)).get();
  if (exists) db.update(settings).set({ value }).where(eq(settings.key, key)).run();
  else db.insert(settings).values({ key, value }).run();
}
