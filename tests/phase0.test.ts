import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isDataless } from "@/lib/fs/dataless";
import { isMountPoint } from "@/lib/env-check";
import { nfc, stripJosa, toBigrams } from "../scripts/phase0/korean-search-bench";

describe("한글 정규화", () => {
  it("NFD 파일 이름을 NFC로 바꾸면 검색어와 일치한다", () => {
    const nfdTitle = "주간회의록".normalize("NFD");
    expect(nfdTitle.includes("회의")).toBe(false);
    expect(nfc(nfdTitle).includes("회의")).toBe(true);
  });
});

describe("검색 보조 함수", () => {
  it("bigram은 붙여 쓴 단어 안의 2글자도 만든다", () => {
    expect(toBigrams("주간회의록").split(" ")).toContain("회의");
  });
  it("조사를 떼어 낸다", () => {
    expect(stripJosa("프로젝트를")).toBe("프로젝트");
    expect(stripJosa("프로젝트에서")).toBe("프로젝트");
    expect(stripJosa("Claude")).toBe("Claude");
  });
});

describe("파일시스템 판별", () => {
  it("내장 디스크의 일반 폴더는 마운트 지점이 아니다 (분리된 디스크의 빈 폴더 오판 방지)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-"));
    expect(isMountPoint(dir)).toBe(false);
    expect(isMountPoint("/")).toBe(false); // 부모가 자기 자신
  });
  it("일반 파일은 dataless가 아니다", () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hub-")), "a.txt");
    fs.writeFileSync(f, "hello");
    expect(isDataless(f, fs.statSync(f))).toBe(false);
  });
});
