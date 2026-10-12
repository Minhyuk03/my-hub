/** 보기용 분류 이름표 (화면·서버 공용) */
export const CATEGORIES = ["doc", "note", "code", "data", "media", "other"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABEL: Record<Category, string> = {
  doc: "문서",
  note: "노트",
  code: "코드",
  data: "데이터",
  media: "사진·영상·소리",
  other: "기타",
};
export const isCategory = (v: string): v is Category => (CATEGORIES as readonly string[]).includes(v);

