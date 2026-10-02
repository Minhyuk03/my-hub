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
  /** 태그 합치기 규칙 (원래 이름 → 합칠 이름). 허브 안에서만 적용, 원본 노트는 그대로 */
  tagAliases: {} as Record<string, string>,
  /** 폴더 이름 비교용 동의어 ("리뉴얼 = renewal") */
  synonyms: DEFAULT_SYNONYMS as string[],
  /** 외부(Tailscale) 접속을 허용할 로그인 계정 */
  allowedTailscaleLogins: [] as string[],
  /** Mac mini 본인 접속(127.0.0.1)에도 패스코드 요구 */
  requireLocalPasscode: false as boolean,
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
  /** 로컬 AI 자동 분류 (Ollama). 제안만 만들고, 수락해야 적용 */
  aiEnabled: false as boolean,
  aiChatModel: "exaone3.5:2.4b" as string,
  aiEmbedModel: "bge-m3" as string,
  /** 한 번에 태그를 제안할 문서 수 (1분마다 실행) */
  aiBatchSize: 10 as number,
  /** 프로젝트 제안 기준 유사도 (0~1, 높을수록 엄격) */
  aiProjectThreshold: 0.62 as number,
  /** 구조용 태그: 제안하지 않는다 */
  aiStructuralTags: ["para", "daily", "weekly"] as string[],
  /** 1분마다 만들 의미 검색 조각 수 */
  aiChunkBudget: 192 as number,
  /** 이 날수 넘게 파일이 바뀌지 않은 진행중 프로젝트를 홈에 알림 (0 이면 끔) */
  staleProjectDays: 30 as number,
  /** 프로젝트별 "알리지 않기" 끝나는 시각 */
  staleSnooze: {} as Record<string, number>,
  /** 홈 일정: Mac 캘린더 앱 연결 여부 (설정에서 "연결" 을 눌러야 켜진다) */
  calendarEnabled: false as boolean,
  /** 홈 일정: 숨길 캘린더 이름 */
  calendarHidden: [] as string[],
  /** AI 채팅 (Phase 5) */
  /** 측정 결과(scripts/ai/bench-chat.ts): 근거 부족·출처 표시·가짜 지시 무시를 가장 잘 지킴 */
  chatLocalModel: "gemma3:4b" as string,
  chatClaudeModel: "claude-sonnet-5-5" as string,
  /** 비어 있으면 OpenAI 를 쓰기 전에 설정에서 고른다 */
  chatOpenAiModel: "" as string,
  /** 요청 하나에 넣는 자료 글자 수 상한 (외부 모델) */
  chatMaxContextChars: 12000 as number,
  /** 외부 AI(Claude·ChatGPT) 사용. 끄면 서버가 외부 요청을 모두 막는다 (로컬 전용) */
  externalAiEnabled: false as boolean,
  /** 하루 외부 AI 요청 횟수 상한 */
  chatDailyExternalLimit: 100 as number,
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
