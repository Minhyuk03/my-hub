import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { folders, projectSuggestions } from "@/server/db/schema";
import {
  createProject,
  linkFolder,
  projectFolderList,
  projectItemList,
  projectsForItem,
  setFolderSubfolders,
  setItemRule,
} from "@/server/projects";
import { importPara, previewParaImport } from "@/server/projects/para";
import { acceptSuggestion, cleanName, computeSuggestions, normalizeName, pendingSuggestions, refreshSuggestions, rejectSuggestion, skeleton } from "@/server/projects/suggest";
import { search } from "@/server/search/query";
import { runScan } from "@/server/sync/scanner";
import { addSource, deps, itemByPath, testDb, tmpDir, write } from "./helpers";

const folderId = (db: ReturnType<typeof testDb>, p: string) => db.select().from(folders).where(eq(folders.path, p)).get()!.id;
const titles = (r: { items: { title: string }[] }) => r.items.map((i) => i.title).sort();

async function twoSources() {
  const db = testDb();
  const icloud = tmpDir("icloud-");
  const vault = tmpDir("vault-");
  write(icloud, "Projects/blog/index.ts", "export {}");
  write(icloud, "Projects/blog/sub/deep.md", "하위");
  write(icloud, "Projects/other/x.md", "다른");
  write(vault, "1. Projects/블로그 리뉴얼/기획.md", "기획 노트");
  const s1 = addSource(db, icloud, { kind: "icloud" });
  const s2 = addSource(db, vault, { kind: "obsidian" });
  await runScan(db, s1.id, deps());
  await runScan(db, s2.id, deps());
  return { db, icloud, vault, s1, s2 };
}

describe("프로젝트 폴더 연결 (3장 ③)", () => {
  it("서로 다른 소스의 폴더를 묶으면 파일이 한 목록에 보인다", async () => {
    const { db, icloud, vault } = await twoSources();
    const p = createProject(db, "블로그 리뉴얼");
    linkFolder(db, p.id, folderId(db, path.join(icloud, "Projects/blog")));
    linkFolder(db, p.id, folderId(db, path.join(vault, "1. Projects/블로그 리뉴얼")));
    expect(titles(projectItemList(db, p.id))).toEqual(["deep", "index.ts", "기획"]);
  });

  it("연결된 폴더에 나중에 생긴 파일도 자동 포함된다", async () => {
    const { db, icloud, s1 } = await twoSources();
    const p = createProject(db, "블로그");
    linkFolder(db, p.id, folderId(db, path.join(icloud, "Projects/blog")));
    write(icloud, "Projects/blog/새 글.md", "새 글");
    await runScan(db, s1.id, deps());
    expect(titles(projectItemList(db, p.id))).toContain("새 글");
  });

  it("하위 폴더 포함 여부를 폴더별로 선택한다", async () => {
    const { db, icloud } = await twoSources();
    const p = createProject(db, "블로그");
    const fid = folderId(db, path.join(icloud, "Projects/blog"));
    linkFolder(db, p.id, fid, { includeSubfolders: false });
    expect(titles(projectItemList(db, p.id))).toEqual(["index.ts"]);
    setFolderSubfolders(db, p.id, fid, true);
    expect(titles(projectItemList(db, p.id))).toEqual(["deep", "index.ts"]);
  });

  it("폴더가 이동·이름 변경돼도 연결이 유지된다", async () => {
    const { db, icloud, s1 } = await twoSources();
    const p = createProject(db, "블로그");
    const fid = folderId(db, path.join(icloud, "Projects/blog"));
    linkFolder(db, p.id, fid);
    fs.renameSync(path.join(icloud, "Projects/blog"), path.join(icloud, "Projects/blog-2026"));
    await runScan(db, s1.id, deps());
    expect(db.select().from(folders).where(eq(folders.id, fid)).get()!.path).toBe(path.join(icloud, "Projects/blog-2026"));
    expect(titles(projectItemList(db, p.id))).toEqual(["deep", "index.ts"]);
  });

  it("연결된 폴더가 삭제되면 연결은 두고 '폴더 없음' 경고", async () => {
    const { db, icloud, s1 } = await twoSources();
    const p = createProject(db, "블로그");
    linkFolder(db, p.id, folderId(db, path.join(icloud, "Projects/blog")));
    fs.rmSync(path.join(icloud, "Projects/blog"), { recursive: true });
    await runScan(db, s1.id, deps());
    const fl = projectFolderList(db, p.id);
    expect(fl).toHaveLength(1);
    expect(fl[0].warning).toMatch("폴더 없음");
    expect(projectItemList(db, p.id).total).toBe(0);
  });

  it("폴더 밖 항목 개별 추가, 폴더 안 항목 제외", async () => {
    const { db, icloud } = await twoSources();
    const p = createProject(db, "블로그");
    linkFolder(db, p.id, folderId(db, path.join(icloud, "Projects/blog")));
    const other = itemByPath(db, path.join(icloud, "Projects/other/x.md"))!;
    const deep = itemByPath(db, path.join(icloud, "Projects/blog/sub/deep.md"))!;
    setItemRule(db, p.id, other.id, "include");
    setItemRule(db, p.id, deep.id, "exclude");
    expect(titles(projectItemList(db, p.id))).toEqual(["index.ts", "x"]);
    expect(projectsForItem(db, other.id).map((x) => x.via)).toEqual(["item"]);
    expect(projectsForItem(db, deep.id)).toEqual([]);
  });

  it("검색에서 프로젝트로 필터한다", async () => {
    const { db, vault } = await twoSources();
    const p = createProject(db, "블로그");
    linkFolder(db, p.id, folderId(db, path.join(vault, "1. Projects/블로그 리뉴얼")));
    expect(search(db, "노트").hits).toHaveLength(1);
    expect(search(db, "하위", { projectId: p.id }).hits).toHaveLength(0);
    expect(search(db, "기획", { projectId: p.id }).hits).toHaveLength(1);
  });
});

describe("폴더 이름 기반 연결 제안", () => {
  it("이름 정규화: 대소문자·공백·-·_ 무시, 날짜·버전 꼬리 제거", () => {
    expect(normalizeName("Blog-Renewal_v2")).toBe(normalizeName("blog renewal"));
    expect(normalizeName("블로그 리뉴얼 2026")).toBe("블로그리뉴얼");
    expect(normalizeName("블로그 리뉴얼 (1)")).toBe("블로그리뉴얼");
    expect(normalizeName("2026-09 블로그 리뉴얼")).toBe("블로그리뉴얼");
    expect(cleanName("01. 블로그")).toBe("블로그");
    // 학기처럼 연도가 이름의 일부면 떼지 않는다
    expect(normalizeName("2025-2학기")).not.toBe(normalizeName("2026-2학기"));
    expect(normalizeName("2026 - 2학기")).toBe(normalizeName("2026-2학기"));
  });
  it("한글·영문 표기 차이: 발음 뼈대", () => {
    expect(skeleton("블로그")).toBe(skeleton("blog"));
    expect(skeleton("블로그리뉴얼")).toBe(skeleton("blogrenewal"));
    expect(skeleton("리뉴얼")).toBe(skeleton("renewal"));
    expect(skeleton("회의")).not.toBe(skeleton("blog"));
  });

  it("다른 소스의 비슷한 폴더를 근거와 함께 제안하고, 수락해야만 연결한다", async () => {
    const { db } = await twoSources();
    refreshSuggestions(db);
    const s = pendingSuggestions(db);
    const blog = s.find((x) => x.folders.some((f) => f!.name === "blog"))!;
    expect(blog).toBeDefined();
    expect(blog.folders.map((f) => f!.name).sort()).toEqual(["blog", "블로그 리뉴얼"]);
    expect(blog.reason).toMatch("blog");
    // 수락 전에는 프로젝트가 없다
    expect(db.$client.prepare("select count(*) from projects").pluck().get()).toBe(0);
    const pid = acceptSuggestion(db, blog.id);
    expect(projectItemList(db, pid).total).toBe(3);
  });

  it("거절한 제안은 다시 띄우지 않는다", async () => {
    const { db } = await twoSources();
    refreshSuggestions(db);
    const s = pendingSuggestions(db)[0];
    rejectSuggestion(db, s.id);
    refreshSuggestions(db);
    expect(pendingSuggestions(db).find((x) => x.key === s.key)).toBeUndefined();
    expect(db.select().from(projectSuggestions).where(eq(projectSuggestions.key, s.key)).get()?.status).toBe("rejected");
  });

  it("짧은 발음 뼈대가 우연히 같은 일부 일치는 제안하지 않는다 (tools ≠ 테트라워치), 긴 것은 제안 (heasarang ≈ 해사랑)", async () => {
    const db = testDb();
    const a = tmpDir();
    const b = tmpDir();
    write(a, "tools/x.md");
    write(b, "01_미래내일_테트라워치/y.md");
    write(a, "heasarang/z.md");
    write(b, "해사랑 스터디/w.md");
    write(a, "멘토링/m.md");
    write(a, "scp/s.md");
    write(b, "족보/j.md");
    write(a, "database/d.md");
    write(b, "데이터베이스/e.md");
    write(b, "시스템 분석과 모니터링/n.md");
    const s1 = addSource(db, a);
    const s2 = addSource(db, b);
    await runScan(db, s1.id, deps());
    await runScan(db, s2.id, deps());
    const reasons = computeSuggestions(db).map((x) => x.reason);
    expect(reasons.some((r) => r.includes("tools"))).toBe(false);
    expect(reasons.some((r) => r.includes("heasarang") && r.includes("해사랑"))).toBe(true);
    expect(reasons.some((r) => r.includes("모니터링"))).toBe(false); // 한글끼리는 발음 뼈대로 묶지 않는다
    expect(reasons.some((r) => r.includes("족보"))).toBe(false); // 모음 없는 약어
    expect(reasons.some((r) => r.includes("database") && r.includes("데이터베이스"))).toBe(true);
  });

  it("같은 소스 안의 폴더끼리, 흔한 폴더 이름은 제안하지 않는다", async () => {
    const db = testDb();
    const a = tmpDir();
    const b = tmpDir();
    write(a, "docs/x.md");
    write(b, "docs/y.md");
    write(a, "여행/1.md");
    write(a, "travel/2.md");
    const s1 = addSource(db, a);
    const s2 = addSource(db, b);
    await runScan(db, s1.id, deps());
    await runScan(db, s2.id, deps());
    expect(computeSuggestions(db)).toEqual([]);
  });

  it("한 폴더가 이미 프로젝트에 있으면 그 프로젝트에 추가하자고 제안한다", async () => {
    const { db, vault } = await twoSources();
    const p = createProject(db, "블로그 리뉴얼");
    linkFolder(db, p.id, folderId(db, path.join(vault, "1. Projects/블로그 리뉴얼")));
    refreshSuggestions(db);
    const s = pendingSuggestions(db).find((x) => x.folders.some((f) => f!.name === "blog"))!;
    expect(s.projectId).toBe(p.id);
    acceptSuggestion(db, s.id);
    expect(projectFolderList(db, p.id)).toHaveLength(2);
  });
});

describe("Obsidian 1. Projects 가져오기", () => {
  it("미리보기 후 선택한 폴더만 프로젝트로 만든다", async () => {
    const { db, vault } = await twoSources();
    write(vault, "1. Projects/허브 만들기/계획.md", "계획");
    const s2 = db.$client.prepare("select id from sources where root_path = ?").pluck().get(vault) as number;
    await runScan(db, s2, deps());
    const dir = path.join(vault, "1. Projects");
    const prev = previewParaImport(db, dir);
    expect(prev.map((p) => p.name)).toEqual(["블로그 리뉴얼", "허브 만들기"]);
    const r = importPara(db, [prev[1].folderId], dir);
    expect(r.created).toBe(1);
    const names = db.$client.prepare("select name from projects").pluck().all();
    expect(names).toEqual(["허브 만들기"]);
  });
});
