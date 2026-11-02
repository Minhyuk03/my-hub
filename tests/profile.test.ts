import { describe, expect, it } from "vitest";
import { EMPTY_PROFILE, linkHref, normalizeProfile } from "@/server/profile";

describe("자기소개 저장값 정리", () => {
  it("비었거나 깨진 값도 빈 자기소개로", () => {
    expect(normalizeProfile(undefined)).toEqual(EMPTY_PROFILE);
    expect(normalizeProfile({ name: 3, links: "x" })).toEqual(EMPTY_PROFILE);
  });

  it("정의된 칸만 남기고, 공개 표시와 허브 프로젝트 연결을 지킨다", () => {
    const p = normalizeProfile({
      name: "홍길동",
      projects: [{ title: "A", projectId: 5, public: true, extra: "버림" }, { title: "B", projectId: "5" }],
      skills: [{ group: "언어", items: "C, Python" }, null],
    });
    expect(p.name).toBe("홍길동");
    expect(p.projects[0]).toEqual({ public: true, title: "A", period: "", role: "", tech: "", summary: "", url: "", projectId: 5 });
    expect(p.projects[1].projectId).toBeNull();
    expect(p.projects[1].public).toBe(false);
    expect(p.skills).toHaveLength(1);
  });

  it("링크 주소: 이메일은 mailto, 프로토콜 없으면 https", () => {
    expect(linkHref("me@example.com")).toBe("mailto:me@example.com");
    expect(linkHref("github.com/me")).toBe("https://github.com/me");
    expect(linkHref("https://a.b")).toBe("https://a.b");
    expect(linkHref(" ")).toBe("");
  });
});
