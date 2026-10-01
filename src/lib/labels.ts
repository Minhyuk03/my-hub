/** 화면 표시용 한국어 이름 (클라이언트에서도 사용) */

export const SOURCE_KIND_LABEL: Record<string, string> = {
  external: "외장 디스크",
  icloud: "iCloud Drive",
  obsidian: "Obsidian",
  local: "내장 디스크",
  gdrive: "Google Drive",
  notion: "Notion",
  github: "GitHub",
};

export const SOURCE_STATUS_LABEL: Record<string, string> = {
  ok: "정상",
  syncing: "동기화 중",
  offline: "오프라인",
  error: "오류",
};

export const ITEM_STATE_LABEL: Record<string, string> = {
  ok: "정상",
  deleted: "삭제됨",
  no_permission: "권한 없음",
  cloud_only: "iCloud에만 있음",
  extract_failed: "추출 실패",
  source_offline: "오프라인",
};

export const NO_CONTENT_LABEL: Record<string, string> = {
  too_large: "파일이 커서 내용 없음",
  unsupported: "내용 없음 (메타데이터만)",
};

export const KIND_LABEL: Record<string, string> = {
  note: "노트",
  document: "문서",
  pdf: "PDF",
  code: "코드",
  image: "이미지",
  video: "영상",
  audio: "오디오",
  archive: "압축",
  other: "기타",
};

/** 검색 결과·목록에서 보여줄 항목 상태. 소스가 오프라인이면 항목도 오프라인으로 표시한다. */
export function displayState(itemState: string, sourceStatus: string, noContentReason?: string | null): { label: string; tone: "ok" | "warn" | "bad" } {
  if (sourceStatus === "offline") return { label: "오프라인", tone: "warn" };
  if (itemState === "ok") return noContentReason ? { label: "내용 없음", tone: "warn" } : { label: "정상", tone: "ok" };
  if (itemState === "cloud_only") return { label: "iCloud에만", tone: "warn" };
  return { label: ITEM_STATE_LABEL[itemState] ?? itemState, tone: "bad" };
}
