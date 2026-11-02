import { describe, expect, it } from "vitest";
import { categoryCounts, folderTrail, folderTree, listFiles } from "@/server/browse";
import { recomputeCategories } from "@/server/category";
import { runScan } from "@/server/sync/scanner";
import { addSource, deps, testDb, tmpDir, write } from "./helpers";

async function setup() {
  const db = testDb();
  const root = tmpDir();
  write(root, "맨위.md", "a");
  write(root, "수업/1주차.md", "b");
  write(root, "수업/과제/보고서.md", "c");
  write(root, "수업/과제/코드.py", "print(1)");
  const src = addSource(db, root);
  await runScan(db, src.id, deps());
  return { db, src };
}

describe("허브 파일 탐색", () => {
  it("폴더 나무: 부모를 경로로 잇고, 하위 포함 개수를 센다", async () => {
    const { db, src } = await setup();
    const t = folderTree(db);
    const s = t.sources.find((x) => x.id === src.id)!;
    expect(s.total).toBe(4);
    const byName = (n: string) => t.nodes.find((x) => x.name === n)!;
    expect(byName("수업")).toMatchObject({ parentId: s.rootFolderId, direct: 1, total: 3 });
    expect(byName("과제")).toMatchObject({ parentId: byName("수업").id, direct: 2, total: 2 });
    expect(folderTrail(t.nodes, byName("과제").id).map((n) => n.name).slice(1)).toEqual(["수업", "과제"]);
  });

  it("파일 목록: 폴더는 바로 든 파일만, 정렬·분류·최근", async () => {
    const { db } = await setup();
    const t = folderTree(db);
    const gwaje = t.nodes.find((x) => x.name === "과제")!;
    expect(listFiles(db, { kind: "folder", id: gwaje.id }, { sort: "name" }).rows.map((r) => r.title)).toEqual(["보고서", "코드.py"]);
    const root = t.sources[0].rootFolderId!;
    expect(listFiles(db, { kind: "folder", id: root }).rows.map((r) => r.title)).toEqual(["맨위"]);
    expect(listFiles(db, { kind: "recent" }).total).toBe(4);
    recomputeCategories(db); // 분류는 워커가 스캔 뒤 정한다
    const cats = categoryCounts(db);
    expect(Object.values(cats).reduce((a, b) => a + b, 0)).toBe(4);
  });
});
