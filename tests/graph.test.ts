import { describe, expect, it } from "vitest";
import { buildGraph, isSingleEmoji, setTagEmoji, tagTree } from "@/server/graph";
import { runScan } from "@/server/sync/scanner";
import { addSource, deps, testDb, tmpDir, write } from "./helpers";

async function vault() {
  const db = testDb();
  const root = tmpDir();
  write(root, "1. Projects/허브.md", "---\ntags: [para/project, 개발]\n---\n[[설계 노트]] 와 [[3. Resources/참고|별칭]] ![[그림.png]] [[없는 노트]]");
  write(root, "1. Projects/설계 노트.md", "#개발 [[허브]]");
  write(root, "3. Resources/참고.md", "#공부 내용");
  write(root, "3. Resources/그림.png", "png");
  write(root, "혼자.md", "연결 없음");
  const src = addSource(db, root, { kind: "obsidian" });
  await runScan(db, src.id, deps());
  return db;
}
const labels = (g: ReturnType<typeof buildGraph>) => g.nodes.map((n) => n.label).sort();

describe("그래프 뷰", () => {
  it("위키링크를 노트끼리 잇고(이름·경로·별칭), 없는 대상과 고립된 노트는 뺀다", async () => {
    const db = await vault();
    const g = buildGraph(db);
    expect(labels(g)).toEqual(["설계 노트", "참고", "허브"]);
    expect(g.stats.links).toBe(3); // 허브→설계, 허브→참고, 설계→허브
  });

  it("옵션: 첨부파일, 고립된 노트, 태그", async () => {
    const db = await vault();
    expect(labels(buildGraph(db, { includeAttachments: true, includeOrphans: true }))).toEqual(["그림.png", "설계 노트", "참고", "허브", "혼자"]);
    const g = buildGraph(db, { includeTags: true });
    expect(g.nodes.filter((n) => n.type === "tag").map((n) => n.label).sort()).toEqual(["#para/project", "#개발", "#공부"]);
  });

  it("색 기준: 최상위 폴더 / 메인 태그", async () => {
    const db = await vault();
    const byFolder = Object.fromEntries(buildGraph(db).nodes.map((n) => [n.label, n.group]));
    expect(byFolder["허브"]).toBe("1. Projects");
    expect(byFolder["참고"]).toBe("3. Resources");
    const byTag = Object.fromEntries(buildGraph(db, { colorBy: "tag" }).nodes.map((n) => [n.label, n.group]));
    expect(byTag["참고"]).toBe("공부");
  });

  it("메인 태그 이모지: 하위 태그에도 적용, 이모지 한 개만", async () => {
    const db = await vault();
    setTagEmoji(db, "para", "📁");
    setTagEmoji(db, "개발", "👨‍💻");
    expect(() => setTagEmoji(db, "공부", "abc")).toThrow();
    expect(() => setTagEmoji(db, "공부", "📚📚")).toThrow();
    const tree = tagTree(db);
    expect(tree.find((t) => t.name === "para")).toMatchObject({ emoji: "📁", children: [{ name: "para/project", count: 1 }] });
    expect(buildGraph(db, { includeTags: true }).nodes.find((n) => n.label === "#para/project")?.emoji).toBe("📁");
    setTagEmoji(db, "para", "");
    expect(tagTree(db).find((t) => t.name === "para")?.emoji).toBeUndefined();
    expect(isSingleEmoji("🇰🇷")).toBe(true);
  });
});

describe("태그로 모든 파일 잇기", () => {
  it("태그 있는 문서(노트가 아닌 것)와 AI 제안 태그(점선)도 그래프에 넣는다", async () => {
    const { testDb, tmpDir, write, addSource, deps } = await import("./helpers");
    const { runScan } = await import("@/server/sync/scanner");
    const { buildGraph } = await import("@/server/graph");
    const { aiSuggestions, items } = await import("@/server/db/schema");
    const db = testDb();
    const root = tmpDir();
    write(root, "노트.md", "#여행 노트");
    write(root, "보고서.txt", "보고서 본문");
    write(root, "계획.txt", "계획 본문");
    const src = addSource(db, root);
    await runScan(db, src.id, deps());
    const id = (t: string) => db.select().from(items).all().find((i) => i.path.endsWith(`/${t}.txt`))!.id;
    for (const [t, tags] of [["보고서", ["여행", "예산"]], ["계획", ["예산", "혼자"]]] as const)
      db.insert(aiSuggestions).values({ itemId: id(t), kind: "tags", payload: { tags: [...tags], summary: "" }, model: "m", textHash: "h", createdAt: 1 }).run();
    const plain = buildGraph(db, { includeTags: true });
    expect(plain.nodes.some((n) => n.itemId === id("보고서"))).toBe(false);
    const g = buildGraph(db, { includeTags: true, allFiles: true, suggested: true });
    expect(g.nodes.find((n) => n.itemId === id("보고서"))?.fileKind).toBeTruthy();
    expect(g.links.filter((l) => l.kind === "suggested")).toHaveLength(3); // 보고서-여행, 보고서-예산, 계획-예산 (혼자는 한 문서뿐이라 뺌)
    expect(g.nodes.some((n) => n.label === "#혼자")).toBe(false);
    expect(g.nodes.some((n) => n.label === "#여행")).toBe(true);
  });
});
