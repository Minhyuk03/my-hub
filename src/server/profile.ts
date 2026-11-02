/**
 * 첫 화면 자기소개·포트폴리오 (settings.profile 에 저장).
 * 항목마다 public 표시를 둔다: 나중에 공개 페이지를 만들 때 public 인 것만 내보낸다.
 */
export type ProfileLink = { label: string; url: string; public: boolean };
export type ProfileEducation = { school: string; major: string; period: string; note: string; public: boolean };
export type ProfileSkill = { group: string; items: string; public: boolean };
export type ProfileExperience = { title: string; org: string; period: string; desc: string; public: boolean };
export type ProfileAward = { title: string; org: string; date: string; public: boolean };
export type ProfileProject = {
  title: string;
  period: string;
  role: string;
  summary: string;
  /** 쓴 기술 (쉼표로 구분) */
  tech: string;
  /** 연결한 허브 프로젝트: 누르면 관련 노트·파일·저장소로 들어간다 */
  projectId: number | null;
  /** 외부 링크 (GitHub, 시연 영상 등) */
  url: string;
  public: boolean;
};

export type Profile = {
  name: string;
  nameEn: string;
  headline: string;
  about: string;
  links: ProfileLink[];
  education: ProfileEducation[];
  skills: ProfileSkill[];
  experience: ProfileExperience[];
  awards: ProfileAward[];
  projects: ProfileProject[];
};

export const EMPTY_PROFILE: Profile = { name: "", nameEn: "", headline: "", about: "", links: [], education: [], skills: [], experience: [], awards: [], projects: [] };

/** 목록 섹션 이름 */
export type ProfileListKey = "links" | "education" | "skills" | "experience" | "awards" | "projects";

/** 편집 화면 입력 칸 정의 (섹션별) */
export const PROFILE_FIELDS: Record<ProfileListKey, { title: string; fields: { key: string; label: string; multiline?: boolean; placeholder?: string }[] }> = {
  links: { title: "연락처·링크", fields: [{ key: "label", label: "이름", placeholder: "이메일, GitHub, 블로그…" }, { key: "url", label: "주소", placeholder: "https://… 또는 이메일 주소" }] },
  education: {
    title: "학력",
    fields: [
      { key: "school", label: "학교" },
      { key: "major", label: "전공" },
      { key: "period", label: "기간", placeholder: "2022.03 – 현재" },
      { key: "note", label: "비고", placeholder: "학점, 부전공 등" },
    ],
  },
  skills: { title: "기술", fields: [{ key: "group", label: "분야", placeholder: "언어, 임베디드, AI…" }, { key: "items", label: "기술 (쉼표로 구분)", placeholder: "C, Python, Swift" }] },
  experience: {
    title: "경력·활동",
    fields: [
      { key: "title", label: "이름·역할" },
      { key: "org", label: "기관" },
      { key: "period", label: "기간" },
      { key: "desc", label: "한 일", multiline: true },
    ],
  },
  awards: { title: "수상·자격증", fields: [{ key: "title", label: "이름" }, { key: "org", label: "주최·발급" }, { key: "date", label: "날짜" }] },
  projects: {
    title: "포트폴리오",
    fields: [
      { key: "title", label: "프로젝트 이름" },
      { key: "period", label: "기간" },
      { key: "role", label: "역할" },
      { key: "tech", label: "기술 (쉼표로 구분)" },
      { key: "summary", label: "설명 (한 일·결과)", multiline: true },
      { key: "url", label: "외부 링크", placeholder: "GitHub, 시연 영상 등" },
    ],
  },
};

const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 5000) : "");

/** 저장된 값이 예전 모양이거나 깨져 있어도 화면이 그려지게 정리 */
export function normalizeProfile(v: unknown): Profile {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const list = (k: ProfileListKey) => {
    const rows = Array.isArray(o[k]) ? (o[k] as Record<string, unknown>[]) : [];
    return rows
      .filter((r) => r && typeof r === "object")
      .map((r) => {
        const out: Record<string, unknown> = { public: r.public === true };
        for (const f of PROFILE_FIELDS[k].fields) out[f.key] = str(r[f.key]);
        if (k === "projects") out.projectId = typeof r.projectId === "number" && r.projectId > 0 ? r.projectId : null;
        return out;
      });
  };
  return {
    name: str(o.name),
    nameEn: str(o.nameEn),
    headline: str(o.headline),
    about: str(o.about),
    links: list("links") as ProfileLink[],
    education: list("education") as ProfileEducation[],
    skills: list("skills") as ProfileSkill[],
    experience: list("experience") as ProfileExperience[],
    awards: list("awards") as ProfileAward[],
    projects: list("projects") as ProfileProject[],
  };
}

/** 링크 주소: 이메일이면 mailto, 프로토콜이 없으면 https */
export function linkHref(url: string) {
  const u = url.trim();
  if (!u) return "";
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u)) return `mailto:${u}`;
  if (/^https?:\/\//i.test(u) || u.startsWith("mailto:")) return u;
  return `https://${u}`;
}
