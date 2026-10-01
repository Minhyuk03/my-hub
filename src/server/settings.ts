import { eq } from "drizzle-orm";
import { DEFAULT_EXCLUDED_FOLDERS, DEFAULT_EXCLUDED_PATTERNS, PATHS } from "@/lib/config";
import { DEFAULT_SYNONYMS } from "./projects/synonyms";
import { normalizeUserPath } from "./sources/rules";
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
  /** 홈 가운데 큰 제목 */
  homeTitle: "나의 허브" as string,
  /** 연결된 Google 계정 (토큰은 키체인에, 여기에는 표시용 정보만) */
  gdriveAccount: null as { email: string; name: string; connectedAt: number } | null,
  /** Google 앱이 "테스트 중" 상태면 연결이 7일마다 만료된다 (프로덕션으로 게시하면 false) */
  gdriveTestingMode: true as boolean,
};

export type Settings = typeof DEFAULT_SETTINGS;

export function getSettings(db: Db): Settings {
  const rows = db.select().from(settings).all();
  const out = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const r of rows) if (r.key in out) out[r.key] = r.value;
  // 예전에 저장된 이스케이프 경로도 바르게 읽는다
  out.excludedFolders = [...new Set((out.excludedFolders as string[]).map(normalizeUserPath).filter(Boolean))];
  return out as Settings;
}

export function setSetting<K extends keyof Settings>(db: Db, key: K, value: Settings[K]) {
  const exists = db.select().from(settings).where(eq(settings.key, key)).get();
  if (exists) db.update(settings).set({ value }).where(eq(settings.key, key)).run();
  else db.insert(settings).values({ key, value }).run();
}
