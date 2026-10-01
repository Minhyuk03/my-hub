import os from "node:os";
import path from "node:path";

/**
 * 허브 기본 설정값. 경로는 셸 이스케이프 없는 실제 경로로 적는다.
 * 사용자가 설정 화면에서 바꾸는 값은 Phase 1부터 DB(settings)에 저장하고, 여기 값은 초기값으로만 쓴다.
 */
export const HOME = os.homedir();

/** DB·로그 등 앱 데이터는 iCloud·외장 디스크가 아닌 내장 디스크에 둔다. */
export const DATA_DIR =
  process.env.HUB_DATA_DIR ?? path.join(HOME, "Library/Application Support/my-hub");

export const PATHS = {
  obsidianVault: path.join(HOME, "Library/Mobile Documents/iCloud~md~obsidian/Documents"),
  icloudDrive: path.join(HOME, "Library/Mobile Documents/com~apple~CloudDocs"),
  claudeProjects: path.join(HOME, ".claude/projects"),
  externalVolumes: ["/Volumes/Disk", "/Volumes/File"],
  backupDir: "/Volumes/Disk/hub-backups",
} as const;

/** 인덱싱할 폴더는 처음엔 비워 두고 설정 화면에서 추가한다. */
export const DEFAULT_INDEXED_FOLDERS: string[] = [];

export const DEFAULT_EXCLUDED_FOLDERS = ["/Volumes/Disk/Nikon", PATHS.backupDir, "/Volumes/Disk/ollama"];

/** 인덱싱하지 않을 볼륨 (이름 패턴). 백업·설치 이미지 볼륨. */
export const EXCLUDED_VOLUME_PATTERNS = [
  /^\/Volumes\/Mac Mini(\/|$)/,
  /^\/Volumes\/MacBook Air(\/|$)/,
  /^\/Volumes\/Recovery(\/|$)/,
  /^\/Volumes\/Kiro CLI( \d+)?(\/|$)/,
  /^\/Volumes\/com\.apple\.TimeMachine\.localsnapshots(\/|$)/,
  /^\/Volumes\/Macintosh HD(\/|$)/,
];

/** 이름 패턴 제외. 비밀 파일(.env, 키 등)은 검색·미리보기에 노출되지 않도록 기본 제외한다. */
export const DEFAULT_EXCLUDED_PATTERNS = [
  "node_modules",
  ".git",
  ".DS_Store",
  "*.app",
  ".env*",
  "*.pem",
  "*.key",
  "*.p12",
  "id_rsa*",
  "id_ed25519*",
  "*.keychain*",
];
