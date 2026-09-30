import { eq } from "drizzle-orm";
import { DEFAULT_EXCLUDED_FOLDERS, DEFAULT_EXCLUDED_PATTERNS, PATHS } from "@/lib/config";
import { DEFAULT_SYNONYMS } from "./projects/synonyms";
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
  /** 폴더 이름 비교용 동의어 ("리뉴얼 = renewal") */
  synonyms: DEFAULT_SYNONYMS as string[],
  /** 외부(Tailscale) 접속을 허용할 로그인 계정 */
  allowedTailscaleLogins: [] as string[],
  /** 앱 패스코드 (scrypt 해시). 비어 있으면 외부 접속 불가 */
  passcodeHash: "" as string,
  /** 홈 배경 이미지 파일 이름 (앱 데이터 폴더 안). 비어 있으면 기본 배경 */
  homeBackground: "" as string,
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
