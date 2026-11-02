import { describe, expect, it } from "vitest";
import { EMPTY_PROFILE, imageSrc, linkHref, normalizeProfile } from "@/server/profile";

describe("자기소개 저장값 정리", () => {
  it("비었거나 깨진 값도 빈 자기소개로", () => {
    expect(normalizeProfile(undefined)).toEqual(EMPTY_PROFILE);
    expect(normalizeProfile({ name: 3, links: "x" })).toEqual({ ...EMPTY_PROFILE, name: "3" });
  });

  it("정의된 칸만 남기고, 공개 표시·허브 프로젝트 연결·별점을 지킨다", () => {
    const p = normalizeProfile({
      name: "홍길동",
      projects: [{ title: "A", projectId: 5, public: true, extra: "버림" }, { title: "B", projectId: "5" }],
      languages: [{ name: "영어", level: 9 }, null],
      skills: [{ group: "Python", items: "데이터 분석" }],
    });
    expect(p.name).toBe("홍길동");
    expect(p.projects[0]).toEqual({ public: true, title: "A", period: "", contribution: "", role: "", result: "", tech: "", summary: "", cover: "", url: "", projectId: 5 });
    expect(p.projects[1]).toMatchObject({ projectId: null, public: false });
    expect(p.languages).toEqual([{ public: false, name: "영어", level: "5" }]);
    expect(p.skills[0]).toMatchObject({ name: "Python", desc: "데이터 분석", level: "0" }); // 예전 모양도 읽는다
  });

  it("링크: 이메일은 mailto, 전화는 tel, 도메인은 https, 그냥 글은 링크 아님", () => {
    expect(linkHref("me@example.com")).toBe("mailto:me@example.com");
    expect(linkHref("010-1234-5678")).toBe("tel:01012345678");
    expect(linkHref("github.com/me")).toBe("https://github.com/me");
    expect(linkHref("https://a.b")).toBe("https://a.b");
    expect(linkHref("부산광역시 영도구")).toBe("");
  });

  it("이미지: 허브 파일 번호·주소는 허브 파일로, https 만 외부", () => {
    expect(imageSrc("1234")).toBe("/api/items/1234/file");
    expect(imageSrc("http://127.0.0.1:3000/items/77")).toBe("/api/items/77/file");
    expect(imageSrc("https://x.com/a.png")).toBe("https://x.com/a.png");
    expect(imageSrc("http://x.com/a.png")).toBe("");
  });
});
