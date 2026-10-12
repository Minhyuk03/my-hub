import path from "node:path";
import { describe, expect, it } from "vitest";
import { baseCategory, recomputeCategories } from "@/server/category";
import { items } from "@/server/db/schema";
import { createProject, linkFolder, projectCategoryCounts, projectItemList } from "@/server/projects";
import { search } from "@/server/search/query";
import { parseFilters } from "@/server/search/params";
import { runScan } from "@/server/sync/scanner";
import { addSource, deps, testDb, tmpDir, write } from "./helpers";

describe("보기용 분류 (문서·노트·코드·데이터·사진영상소리·기타)", () => {
  it("확장자·경로 규칙", () => {
    expect(baseCategory("pdf", "pdf", "/a/보고서.pdf")).toBe("doc");
    expect(baseCategory("notion", "document", "notion:/r/페이지#1")).toBe("doc");
    expect(baseCategory("md", "note", "/v/노트.md")).toBe("note");
    expect(baseCategory("jsonl", "chat", "/c/세션.jsonl")).toBe("note");
    expect(baseCategory("py", "code", "/p/main.py")).toBe("code");
    expect(baseCategory("plist", "other", "/p/Info.plist")).toBe("code");
    expect(baseCategory("csv", "document", "/d/표.csv")).toBe("data");
    expect(baseCategory("hdf5", "other", "/d/model.hdf5")).toBe("data");
    expect(baseCategory("jpg", "image", "/여행/사진.jpg")).toBe("media");
    expect(baseCategory("jpg", "image", "/수업/data/train/ad/1.jpg")).toBe("data");
    expect(baseCategory("png", "image", "/app/Assets.xcassets/AppIcon.appiconset/i.png")).toBe("code");
    expect(baseCategory("json", "code", "/p/data/labels.json")).toBe("data");
    expect(baseCategory("zip", "archive", "/a/묶음.zip")).toBe("other");
    expect(baseCategory("ipynb", "other", "gdrive:/r/실습.ipynb#1")).toBe("code");
  });

  it("한 폴더에 같은 종류가 50개 이상 몰린 사진·소리는 데이터, 적으면 사진", async () => {
    const db = testDb();
    const root = tmpDir();
    for (let i = 0; i < 55; i++) write(root, `audio_samples/s${i}.wav`, "RIFF" + i);
    for (let i = 0; i < 5; i++) write(root, `여행/p${i}.jpg`, "jpg" + i);
    write(root, "노트.md", "# 노트 본문");
    write(root, "보고서.txt", "보고서 내용");
    const src = addSource(db, root);
    await runScan(db, src.id, deps());
    recomputeCategories(db);
    const cat = (rel: string) => db.select().from(items).all().find((i) => i.path === path.join(root, rel))!.category;
    expect(cat("audio_samples/s0.wav")).toBe("data");
    expect(cat("여행/p0.jpg")).toBe("media");
    expect(cat("노트.md")).toBe("note");
    expect(recomputeCategories(db)).toBe(0); // 바뀐 것만 저장
  });

  it("검색과 PARA 목록에서 고른 분류만 보인다", async () => {
    const db = testDb();
    const root = tmpDir();
    write(root, "알파/계획.md", "알파 계획 노트");
    write(root, "알파/측정.csv", "알파,값\n1,2");
    write(root, "알파/main.py", "# 알파 코드");
    const src = addSource(db, root);
    await runScan(db, src.id, deps());
    recomputeCategories(db);
    const p = new URLSearchParams("q=알파&cat=data&cat=note");
    const f = parseFilters(p);
    expect(search(db, "알파", f).hits.map((h) => h.title).sort()).toEqual(["계획", "측정.csv"]);
    expect(parseFilters(new URLSearchParams("cat=doc&cat=note&cat=code&cat=data&cat=media&cat=other")).categories).toBeUndefined(); // 전부 = 필터 없음
    const pr = createProject(db, "알파");
    const fid = db.$client.prepare(`SELECT id FROM folders WHERE path = ?`).pluck().get(path.join(root, "알파")) as number;
    linkFolder(db, pr.id, fid);
    expect(projectItemList(db, pr.id, { categories: ["code"] }).items.map((i) => i.title)).toEqual(["main.py"]);
    expect(projectCategoryCounts(db, pr.id)).toEqual({ note: 1, data: 1, code: 1 });
  });
});
