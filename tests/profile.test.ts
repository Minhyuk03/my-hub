import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EMPTY_PROFILE, imagePos, imageSrc, linkHref, normalizeProfile, splitImageRef, withImagePos } from "@/server/profile";
import { referencedUploads, removeUnusedUploads, saveProfileImage } from "@/server/profile-images";
import { tmpDir } from "./helpers";

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

  it("이미지 보일 위치: 값 끝의 #가로,세로 는 주소에서 빼고 object-position 으로", () => {
    expect(withImagePos("upload:0123456789abcdef.jpg", 30.4, 120)).toBe("upload:0123456789abcdef.jpg#30,100");
    expect(withImagePos("upload:0123456789abcdef.jpg#30,10", 50, 50)).toBe("upload:0123456789abcdef.jpg");
    expect(withImagePos("", 10, 10)).toBe("");
    expect(imageSrc("upload:0123456789abcdef.jpg#30,10")).toBe("/api/profile-images/0123456789abcdef.jpg");
    expect(imageSrc("1234#0,100")).toBe("/api/items/1234/file");
    expect(imagePos("1234#0,100")).toBe("0% 100%");
    expect(imagePos("1234")).toBe("50% 50%");
    expect(splitImageRef("https://x.com/a.png#frag")).toEqual({ ref: "https://x.com/a.png#frag", x: 50, y: 50 });
  });
});

describe("자기소개 사진 올리기", () => {
  it("이미지만 무작위 이름으로 저장하고, upload: 값은 사진 주소가 된다", () => {
    const dir = tmpDir();
    expect(saveProfileImage("a.txt", "text/plain", Buffer.from("x"), dir)).toMatchObject({ ok: false });
    expect(saveProfileImage("a.png", "image/png", Buffer.alloc(0), dir)).toMatchObject({ ok: false });
    const r = saveProfileImage("내 사진.PNG", "image/png", Buffer.from("png"), dir);
    expect(r.ok).toBe(true);
    const ref = (r as { ref: string }).ref;
    expect(ref).toMatch(/^upload:[a-f0-9]{16}\.png$/);
    expect(fs.existsSync(path.join(dir, ref.slice(7)))).toBe(true);
    expect(imageSrc(ref)).toBe(`/api/profile-images/${ref.slice(7)}`);
    expect(imageSrc("upload:../../hub.db")).toBe("");
  });

  it("저장할 때 더 쓰지 않는 사진만, 한 시간 넘은 것만 지운다", () => {
    const dir = tmpDir();
    const used = (saveProfileImage("a.jpg", "image/jpeg", Buffer.from("1"), dir) as { ref: string }).ref;
    const old = (saveProfileImage("b.jpg", "image/jpeg", Buffer.from("2"), dir) as { ref: string }).ref;
    const fresh = (saveProfileImage("c.jpg", "image/jpeg", Buffer.from("3"), dir) as { ref: string }).ref;
    const hourAgo = new Date(Date.now() - 2 * 3600_000);
    for (const r of [used, old]) fs.utimesSync(path.join(dir, r.slice(7)), hourAgo, hourAgo);
    // 보일 위치를 붙여도 쓰는 사진으로 센다
    const p = normalizeProfile({ photo: `${used}#40,20` });
    expect(referencedUploads(p)).toEqual(new Set([used.slice(7)]));
    expect(removeUnusedUploads(p, Date.now(), dir)).toBe(1);
    expect(fs.readdirSync(dir).sort()).toEqual([used.slice(7), fresh.slice(7)].sort());
  });
});
