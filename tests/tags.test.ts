import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildGraph } from "@/server/graph";
import { search } from "@/server/search/query";
import { setSetting } from "@/server/settings";
import { runScan } from "@/server/sync/scanner";
import { aliasOf, applyTagAliases, parseAliasLines } from "@/server/tags";
import { addSource, deps, testDb, tmpDir, write } from "./helpers";

const tagNames = (db: ReturnType<typeof testDb>) =>
  (db.$client.prepare(`SELECT DISTINCT g.name FROM v_item_tags it JOIN tags g ON g.id = it.tag_id ORDER BY g.name`).pluck().all() as string[]);

describe("태그 합치기 (허브 안에서만)", () => {
  it("규칙: 대소문자 무시, 하위 태그도 따라감, 연쇄·순환 처리", () => {
    const a = { 수업: "학교", 강의노트: "수업", js: "JavaScript", x: "y", y: "x" };
    expect(aliasOf(a, "수업")).toBe("학교");
    expect(aliasOf(a, "강의노트")).toBe("학교"); // 연쇄
    expect(aliasOf(a, "수업/자료구조")).toBe("학교/자료구조");
    expect(aliasOf(a, "JS")).toBe("JavaScript");
    expect(aliasOf(a, "수업료")).toBe("수업료"); // 앞부분만 같은 다른 태그는 그대로
    expect(["x", "y"]).toContain(aliasOf(a, "x")); // 순환해도 멈춘다
    expect(parseAliasLines("수업 = 학교\n#코드 → 개발\n잘못된 줄\n같음 = 같음")).toEqual({ 수업: "학교", 코드: "개발" });
  });

  it("이미 저장된 태그를 합치고, 다시 색인해도 합친 이름으로 유지되며, 원본 노트는 그대로", async () => {
    const db = testDb();
    const root = tmpDir();
    write(root, "a.md", "#학교 첫 노트");
    write(root, "b.md", "#수업 #수업/자료구조 두 번째 노트");
    write(root, "c.md", "#강의노트 세 번째");
    const src = addSource(db, root);
    await runScan(db, src.id, deps());
    expect(tagNames(db)).toEqual(["강의노트", "수업", "수업/자료구조", "학교"]);

    const rules = { 수업: "학교", 강의노트: "학교" };
    setSetting(db, "tagAliases", rules);
    applyTagAliases(db, rules);
    expect(tagNames(db)).toEqual(["학교", "학교/자료구조"]);
    expect(search(db, "노트", { tag: "학교" }).total).toBe(3);
    expect(buildGraph(db, { includeTags: true }).nodes.filter((n) => n.type === "tag").map((n) => n.label).sort()).toEqual(["#학교", "#학교/자료구조"]);

    fs.writeFileSync(path.join(root, "b.md"), "#수업 바뀐 두 번째");
    await runScan(db, src.id, deps());
    expect(tagNames(db)).toEqual(["학교"]);
    expect(fs.readFileSync(path.join(root, "b.md"), "utf8")).toBe("#수업 바뀐 두 번째");

    // 규칙을 지우고 다시 색인하면 원래 이름으로
    setSetting(db, "tagAliases", {});
    fs.writeFileSync(path.join(root, "b.md"), "#수업 또 바뀜");
    await runScan(db, src.id, deps());
    expect(tagNames(db)).toContain("수업");
  });
});
