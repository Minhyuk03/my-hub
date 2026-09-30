import fs from "node:fs";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { extractText, hwpxText, markdown } from "@/server/extract";
import { search } from "@/server/search/query";
import { checkNewFolder, checkNewSource, matchPattern } from "@/server/sources/rules";
import { runScan } from "@/server/sync/scanner";
import { addSource, deps, testDb, tmpDir, write } from "./helpers";

async function corpus() {
  const db = testDb();
  const root = tmpDir();
  write(root, "주간회의록 2026-09-28.md".normalize("NFD"), "");
  write(root, "회의 준비 메모.md", "다음 주 회의 준비: 안건 정리");
  write(root, "팀 회의록.md", "회의록 초안입니다.");
  write(root, "블로그 리뉴얼 기획.md", "프로젝트를 시작한다. 프로젝트에서 중요한 것은 일정이다.");
  write(root, "동기화 설계.md", "노션 페이지를 옵시디언으로 옮긴 뒤 한참 후에 동기화를 한다.");
  write(root, "노션만.md", "노션 워크스페이스 정리");
  write(root, "CLAUDE CODE 사용기.md", "claude code 세션 기록과 2026년 9월 계획");
  write(root, "회의적인 의견.md", "이 방식에는 회의적이다");
  write(root, "메모장.md", "지난 회의 내용 정리");
  const src = addSource(db, root);
  await runScan(db, src.id, deps());
  return db;
}
const titles = (r: ReturnType<typeof search>) => r.hits.map((h) => h.title).sort();

describe("한국어 검색 B2 (4장 검증 사례)", () => {
  it("회의 (2글자): 붙여 쓴 경우 포함, 제목 일치가 먼저", async () => {
    const db = await corpus();
    const r = search(db, "회의");
    expect(titles(r)).toEqual(["메모장", "주간회의록 2026-09-28", "팀 회의록", "회의 준비 메모", "회의적인 의견"].sort());
    // 본문에만 있는 항목은 제목에 있는 항목보다 뒤
    expect(r.hits[r.hits.length - 1].title).toBe("메모장");
  });
  it("회의록: 주간회의록 포함", async () => {
    const db = await corpus();
    expect(titles(search(db, "회의록"))).toEqual(["주간회의록 2026-09-28", "팀 회의록"].sort());
  });
  it("프로젝트: 조사 붙은 형태", async () => {
    const db = await corpus();
    expect(titles(search(db, "프로젝트"))).toEqual(["블로그 리뉴얼 기획"]);
  });
  it("노션 동기화: 떨어져 있어도 모두 포함된 문서만", async () => {
    const db = await corpus();
    expect(titles(search(db, "노션 동기화"))).toEqual(["동기화 설계"]);
  });
  it("Claude Code / 2026년 9월: 대소문자 무시, 숫자 포함", async () => {
    const db = await corpus();
    expect(titles(search(db, "Claude Code"))).toEqual(["CLAUDE CODE 사용기"]);
    expect(titles(search(db, "2026년 9월"))).toEqual(["CLAUDE CODE 사용기"]);
  });
  it("검색어 하이라이트 위치를 돌려준다", async () => {
    const db = await corpus();
    const h = search(db, "안건").hits[0];
    const [s, e] = h.highlights[0];
    expect(h.snippet.slice(s, e)).toBe("안건");
  });
  it("필터: 형식·수정일", async () => {
    const db = await corpus();
    expect(search(db, "회의", { kinds: ["pdf"] }).hits).toHaveLength(0);
    expect(search(db, "회의", { modifiedAfter: Date.now() + 86400_000 }).hits).toHaveLength(0);
  });
});

describe("텍스트 추출", () => {
  it("HWPX 본문", () => {
    const xml = `<?xml version="1.0"?><hs:sec><hp:p><hp:run><hp:t>한글 문서 &amp; 테스트</hp:t></hp:run></hp:p><hp:p><hp:run><hp:t>둘째 줄</hp:t></hp:run></hp:p></hs:sec>`;
    const zip = zipSync({ mimetype: strToU8("application/hwp+zip"), "Contents/section0.xml": strToU8(xml) });
    expect(hwpxText(Buffer.from(zip))).toBe("한글 문서 & 테스트\n둘째 줄");
  });
  it("DOCX 본문", async () => {
    const zip = zipSync({
      "[Content_Types].xml": strToU8(
        `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
      ),
      "_rels/.rels": strToU8(
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
      ),
      "word/document.xml": strToU8(
        `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>워드 문서 본문</w:t></w:r></w:p></w:body></w:document>`,
      ),
    });
    const r = await extractText("docx", Buffer.from(zip));
    expect(r.body.trim()).toBe("워드 문서 본문");
  });
  it("PDF 본문", async () => {
    const r = await extractText("pdf", minimalPdf("Hello PDF 2026"));
    expect(r.body).toContain("Hello PDF 2026");
  });
  it("이진 파일은 텍스트로 취급하지 않는다", async () => {
    await expect(extractText("txt", Buffer.from([0x41, 0x00, 0x42]))).rejects.toThrow();
  });
  it("Markdown: frontmatter 태그, 인라인 태그, 위키링크 (코드 블록 안 #은 제외)", () => {
    const r = markdown("---\ntags: 기획\n---\n# 제목\n본문 #할일 `#아님`\n```\n#코드\n```\n[[노트#섹션|별칭]] ![[그림.png]]");
    expect(r.tags.sort()).toEqual(["기획", "할일"]);
    expect(r.links.sort()).toEqual(["그림.png", "노트"]);
  });
});

describe("인덱싱 폴더 추가 규칙", () => {
  it("제외 폴더·제외 볼륨·중복 등록은 막고, 겹치는 경로는 경고", () => {
    const root = tmpDir();
    fs.mkdirSync(path.join(root, "사진"));
    fs.mkdirSync(path.join(root, "문서/하위"), { recursive: true });
    const ctx = { existingRoots: [path.join(root, "문서")], excludedFolders: [path.join(root, "사진")] };
    expect(checkNewSource(path.join(root, "사진"), ctx).ok).toBe(false);
    expect(checkNewSource("/Volumes/Recovery", ctx).ok).toBe(false);
    expect(checkNewSource(path.join(root, "문서"), ctx).error).toMatch("이미 등록");
    const nested = checkNewSource(path.join(root, "문서/하위"), ctx);
    expect(nested.ok).toBe(true);
    expect(nested.warnings.join()).toMatch("하위 폴더");
    expect(checkNewSource(path.join(root, "없음"), ctx).ok).toBe(false);
  });
  it("새 폴더는 외장 디스크 안에서만, 이미 있으면 안 됨", () => {
    const root = tmpDir();
    expect(checkNewFolder(root, "새 폴더", []).ok).toBe(false); // 외장 디스크 아님
    expect(checkNewFolder("/Volumes/Disk", "../x", []).ok).toBe(false);
    expect(checkNewFolder("/Volumes/Disk", "Nikon", ["/Volumes/Disk/Nikon"]).ok).toBe(false);
  });
  it("이름 패턴", () => {
    expect(matchPattern("Foo.app", "*.app")).toBe(true);
    expect(matchPattern(".env.local", ".env*")).toBe(true);
    expect(matchPattern("node_modules", "node_modules")).toBe(true);
    expect(matchPattern("my_node_modules", "node_modules")).toBe(false);
  });
});

/** 텍스트 한 줄짜리 PDF를 만든다 (테스트용) */
function minimalPdf(text: string): Buffer {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 18 Tf 20 60 Td (${text}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}
