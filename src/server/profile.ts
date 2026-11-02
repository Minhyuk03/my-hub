/**
 * 첫 화면 자기소개·포트폴리오 (settings.profile 에 저장).
 * 화면: 배경 사진 위 이름·한 줄 소개 → 자기소개 → 프로필(교육·경력·스킬 등) → 프로젝트 사진 격자 → 연락처·SNS.
 * 항목마다 public 표시를 둔다: 나중에 공개 페이지를 만들 때 public 인 것만 내보낸다.
 */
type Row<K extends string> = Record<K, string> & { public: boolean };
export type ProfileLink = Row<"label" | "url">;
export type ProfileEducation = Row<"school" | "major" | "period" | "note">;
export type ProfileLanguage = Row<"name" | "level">;
export type ProfileExperience = Row<"title" | "org" | "period" | "desc">;
export type ProfileAward = Row<"title" | "org" | "date">;
export type ProfileSkill = Row<"name" | "level" | "desc">;
export type ProfileProject = Row<"title" | "period" | "contribution" | "role" | "result" | "tech" | "summary" | "cover" | "url"> & {
  /** 연결한 허브 프로젝트: 누르면 관련 노트·파일·저장소로 들어간다 */
  projectId: number | null;
};
export type ProfileActivity = Row<"title" | "date" | "org">;
export type ProfileSns = Row<"title" | "desc" | "url">;

export type Profile = {
  name: string;
  nameEn: string;
  headline: string;
  about: string;
  /** 프로필 사진: 허브 파일 번호·/items/번호·https 주소 */
  photo: string;
  /** 첫 화면 맨 위 배경 사진 (같은 형식) */
  hero: string;
  links: ProfileLink[];
  education: ProfileEducation[];
  languages: ProfileLanguage[];
  experience: ProfileExperience[];
  awards: ProfileAward[];
  skills: ProfileSkill[];
  projects: ProfileProject[];
  activities: ProfileActivity[];
  sns: ProfileSns[];
};

export const EMPTY_PROFILE: Profile = {
  name: "",
  nameEn: "",
  headline: "",
  about: "",
  photo: "",
  hero: "",
  links: [],
  education: [],
  languages: [],
  experience: [],
  awards: [],
  skills: [],
  projects: [],
  activities: [],
  sns: [],
};

/** 목록 섹션 (편집 화면 순서) */
export const PROFILE_LISTS = ["links", "education", "languages", "experience", "awards", "skills", "projects", "activities", "sns"] as const;
export type ProfileListKey = (typeof PROFILE_LISTS)[number];

export type FieldDef = { key: string; label: string; type?: "multiline" | "stars" | "image"; placeholder?: string };

/** 편집 화면 입력 칸 정의 (섹션별) */
export const PROFILE_FIELDS: Record<ProfileListKey, { title: string; hint: string; fields: FieldDef[] }> = {
  links: {
    title: "연락처",
    hint: "전화·이메일·지역 등. 이메일·전화번호·웹 주소는 누를 수 있는 링크가 됩니다.",
    fields: [
      { key: "label", label: "이름", placeholder: "T, E, A 또는 전화·이메일·지역" },
      { key: "url", label: "내용", placeholder: "010-0000-0000, me@example.com" },
    ],
  },
  education: {
    title: "교육",
    hint: "기간 · 학교 ⎜ 전공 · 비고",
    fields: [
      { key: "period", label: "기간", placeholder: "2022.03 - 현재" },
      { key: "school", label: "학교" },
      { key: "major", label: "전공" },
      { key: "note", label: "비고", placeholder: "학점 : 4.0" },
    ],
  },
  languages: {
    title: "언어",
    hint: "언어와 숙련도(별 1~5개)",
    fields: [
      { key: "name", label: "언어", placeholder: "영어" },
      { key: "level", label: "숙련도", type: "stars" },
    ],
  },
  experience: {
    title: "경력",
    hint: "한 일은 한 줄에 하나씩 쓰면 목록으로 보입니다.",
    fields: [
      { key: "period", label: "기간", placeholder: "2024.04 - 현재" },
      { key: "org", label: "기관" },
      { key: "title", label: "역할" },
      { key: "desc", label: "한 일 (한 줄에 하나)", type: "multiline" },
    ],
  },
  awards: {
    title: "자격증·수상",
    hint: "날짜와 이름",
    fields: [
      { key: "date", label: "날짜", placeholder: "2024.05" },
      { key: "title", label: "이름" },
      { key: "org", label: "발급·주최" },
    ],
  },
  skills: {
    title: "스킬",
    hint: "도구·기술마다 카드 하나. 별이 많은 순서로 보입니다.",
    fields: [
      { key: "name", label: "이름", placeholder: "Python" },
      { key: "level", label: "숙련도", type: "stars" },
      { key: "desc", label: "할 수 있는 것", placeholder: "데이터 분석, 모델 학습" },
    ],
  },
  projects: {
    title: "프로젝트",
    hint: "표지 사진을 비우면 연결한 허브 프로젝트의 첫 이미지를 씁니다.",
    fields: [
      { key: "title", label: "프로젝트 이름" },
      { key: "period", label: "기간", placeholder: "2025.08.05 → 2025.08.14" },
      { key: "contribution", label: "기여도", placeholder: "100%" },
      { key: "role", label: "역할" },
      { key: "result", label: "결과", placeholder: "본선 진출, 정확도 92%" },
      { key: "tech", label: "기술 (쉼표로 구분)" },
      { key: "summary", label: "설명", type: "multiline" },
      { key: "cover", label: "표지 사진", type: "image" },
      { key: "url", label: "외부 링크", placeholder: "GitHub, 시연 영상 등" },
    ],
  },
  activities: {
    title: "여러가지 경험",
    hint: "봉사·동아리·사이드 프로젝트 등 경력 밖의 경험",
    fields: [
      { key: "title", label: "경험" },
      { key: "date", label: "날짜·기간" },
      { key: "org", label: "단체·장소" },
    ],
  },
  sns: {
    title: "SNS",
    hint: "블로그·GitHub·인스타그램 등. 북마크 카드로 보입니다.",
    fields: [
      { key: "title", label: "이름", placeholder: "GitHub" },
      { key: "desc", label: "설명" },
      { key: "url", label: "주소" },
    ],
  },
};

const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 5000) : typeof v === "number" ? String(v) : "");

/** 저장된 값이 예전 모양이거나 깨져 있어도 화면이 그려지게 정리 */
export function normalizeProfile(v: unknown): Profile {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const list = (k: ProfileListKey) => {
    const rows = Array.isArray(o[k]) ? (o[k] as Record<string, unknown>[]) : [];
    return rows
      .filter((r) => r && typeof r === "object")
      .map((r) => {
        // 예전 스킬 모양 {group, items} → {name, desc}
        if (k === "skills" && !r.name && r.group) r = { ...r, name: r.group, desc: r.items };
        const out: Record<string, unknown> = { public: r.public === true };
        for (const f of PROFILE_FIELDS[k].fields) out[f.key] = f.type === "stars" ? String(stars(r[f.key])) : str(r[f.key]);
        if (k === "projects") out.projectId = typeof r.projectId === "number" && r.projectId > 0 ? r.projectId : null;
        return out;
      });
  };
  const out = { name: str(o.name), nameEn: str(o.nameEn), headline: str(o.headline), about: str(o.about), photo: str(o.photo), hero: str(o.hero) } as Profile;
  for (const k of PROFILE_LISTS) (out as Record<string, unknown>)[k] = list(k);
  return out;
}

/** 별 개수 0~5 */
export function stars(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(5, Math.max(0, n)) : 0;
}

/** 링크 주소: 이메일이면 mailto, 전화번호면 tel, 프로토콜이 없는 웹 주소면 https. 그 밖의 글은 링크 아님 */
export function linkHref(url: string) {
  const u = url.trim();
  if (!u) return "";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u)) return `mailto:${u}`;
  if (/^\+?[\d\s-]{8,}$/.test(u)) return `tel:${u.replace(/[\s-]/g, "")}`;
  if (/^https?:\/\//i.test(u) || u.startsWith("mailto:")) return u;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(u)) return `https://${u}`;
  return "";
}

/** 이미지 칸 값 → 화면에 쓸 주소. 허브 파일 번호·/items/번호 는 허브 파일, https 는 그대로 */
export function imageSrc(ref: string): string {
  const r = ref.trim();
  const id = r.match(/^(\d+)$/)?.[1] ?? r.match(/\/items\/(\d+)/)?.[1];
  if (id) return `/api/items/${id}/file`;
  if (/^https:\/\//i.test(r)) return r;
  return "";
}
