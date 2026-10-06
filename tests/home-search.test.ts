import { describe, expect, it } from "vitest";
import { asUrl, googleUrl } from "@/components/home/home-search";

describe("홈 검색창 (Google)", () => {
  it("주소처럼 보이면 그 주소로, 아니면 Google 검색", () => {
    expect(asUrl("github.com")).toBe("https://github.com");
    expect(asUrl("https://claude.ai/new")).toBe("https://claude.ai/new");
    expect(asUrl("kmou.ac.kr/main")).toBe("https://kmou.ac.kr/main");
    expect(asUrl("리눅스 부팅 과정")).toBeNull();
    expect(asUrl("node.js 설치")).toBeNull();
    expect(googleUrl(" 캡스톤 & 예산 ")).toBe("https://www.google.com/search?q=%EC%BA%A1%EC%8A%A4%ED%86%A4%20%26%20%EC%98%88%EC%82%B0");
  });
});
