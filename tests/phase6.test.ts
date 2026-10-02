import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { itemEmbeddings, items, paraMoves, projects, sources } from "@/server/db/schema";
import { duplicateGroups, duplicateSummary } from "@/server/duplicates";
import { createProject, linkFolder, updateProject } from "@/server/projects";
import { acceptParaMove, generateParaMoves, pendingParaMoves, rejectParaMove } from "@/server/projects/para-moves";
import { snoozeStale, staleProjects } from "@/server/projects/stale";
import { getSettings } from "@/server/settings";
import { runScan } from "@/server/sync/scanner";
import { addSource, deps, testDb, tmpDir, write } from "./helpers";

const DAY = 86400_000;

describe("중복 파일 (목록만)", () => {
  it("내용이 같은 파일을 묶고, 크기 기준으로 거르며, 파일은 건드리지 않는다", async () => {
    const db = testDb();
    const root = tmpDir();
    const big = "가".repeat(2000);
    write(root, "a/보고서.md", big);
    write(root, "b/보고서 사본.md", big);
    write(root, "c/또 사본.md", big);
    write(root, "작은1.txt", "x");
    write(root, "작은2.txt", "x");
    write(root, "다름.md", "다른 내용 " + big);
    const src = addSource(db, root);
    await runScan(db, src.id, deps());
    const g = duplicateGroups(db, { minSize: 1024 });
    expect(g).toHaveLength(1);
    expect(g[0].count).toBe(3);
    expect(g[0].items.map((i) => i.title).sort()).toEqual(["또 사본", "보고서", "보고서 사본"]);
    expect(duplicateSummary(db, 1024)).toMatchObject({ groups: 1, extra: 2, wasted: 2 * g[0].size });
    expect(duplicateGroups(db, { minSize: 1 })).toHaveLength(2);
    expect(fs.readdirSync(root).sort()).toEqual(["a", "b", "c", "다름.md", "작은1.txt", "작은2.txt"]);
  });
});

describe("쉬고 있는 프로젝트 알림", () => {
  it("진행중이고 파일이 N일 넘게 안 바뀐 프로젝트만, 알리지 않기는 N일 동안", async () => {
    const db = testDb();
    const root = tmpDir();
    const old = write(root, "옛날/노트.md", "옛날 노트");
    write(root, "요즘/노트.md", "요즘 노트");
    const t = Date.now();
    fs.utimesSync(old, new Date(t - 60 * DAY), new Date(t - 60 * DAY));
    const src = addSource(db, root);
    await runScan(db, src.id, deps());
    const folderId = (rel: string) => db.$client.prepare(`SELECT id FROM folders WHERE path = ?`).pluck().get(path.join(root, rel)) as number;
    const a = createProject(db, "옛날 프로젝트");
    const b = createProject(db, "요즘 프로젝트");
    linkFolder(db, a.id, folderId("옛날"));
    linkFolder(db, b.id, folderId("요즘"));
    expect(staleProjects(db, t).map((p) => p.name)).toEqual(["옛날 프로젝트"]);
    snoozeStale(db, a.id, t);
    expect(staleProjects(db, t + DAY)).toHaveLength(0);
    // 31일 뒤: 알리지 않기가 끝났고, 요즘 프로젝트도 이제 30일 넘게 쉬는 중
    expect(staleProjects(db, t + 31 * DAY).map((p) => p.name)).toEqual(["옛날 프로젝트", "요즘 프로젝트"]);
    updateProject(db, a.id, { status: "on_hold" });
    expect(staleProjects(db, t + 31 * DAY).map((p) => p.name)).toEqual(["요즘 프로젝트"]);
    expect(getSettings(db).staleProjectDays).toBe(30);
  });
});

describe("Obsidian 노트 정리 제안 (수락해야만 옮김)", () => {
  async function vault() {
    const db = testDb();
    const root = tmpDir();
    for (const d of ["1. Projects/대회/로봇 대회", "2. Areas", "3. Resources/개발", "3. Resources/요리", "4. Archives"]) fs.mkdirSync(path.join(root, d), { recursive: true });
    write(root, "1. Projects/대회/로봇 대회/계획.md", "로봇 대회 계획");
    for (let i = 0; i < 5; i++) write(root, `3. Resources/개발/개발노트${i}.md`, `리눅스 개발 ${i}`);
    for (let i = 0; i < 3; i++) write(root, `3. Resources/요리/요리${i}.md`, `요리 ${i}`);
    write(root, "떠도는 리눅스 메모.md", "리눅스 명령어 메모");
    const src = addSource(db, root, { kind: "obsidian" });
    db.update(sources).set({ kind: "obsidian" }).where(eq(sources.id, src.id)).run();
    await runScan(db, src.id, deps());
    // 가짜 임베딩: 개발 노트와 떠도는 메모는 같은 방향, 요리는 다른 방향
    const all = db.select().from(items).all();
    for (const it of all) {
      const v = new Float32Array(4);
      if (/개발노트|떠도는/.test(it.title)) v[0] = 1;
      else if (/요리/.test(it.title)) v[1] = 1;
      else v[2] = 1;
      db.insert(itemEmbeddings).values({ itemId: it.id, model: "bge-m3", vector: Buffer.from(v.buffer), textHash: "x", createdAt: 1 }).run();
    }
    const folderId = db.$client.prepare(`SELECT id FROM folders WHERE path = ?`).pluck().get(path.join(root, "1. Projects/대회/로봇 대회")) as number;
    return { db, root, folderId };
  }

  it("완료한 프로젝트 폴더는 4. Archives 로, PARA 밖 노트는 비슷한 노트들의 폴더로 제안한다", async () => {
    const { db, root, folderId } = await vault();
    const p = createProject(db, "로봇 대회");
    linkFolder(db, p.id, folderId);
    expect(generateParaMoves(db)).toBe(1); // 아직 완료가 아니라 노트 제안만
    db.update(projects).set({ status: "done" }).where(eq(projects.id, p.id)).run();
    expect(generateParaMoves(db)).toBe(1);
    const list = pendingParaMoves(db);
    expect(list.map((m) => [m.kind, m.fromLabel, m.toLabel]).sort()).toEqual([
      ["archive", "1. Projects/대회/로봇 대회", "4. Archives/로봇 대회"],
      ["note", "떠도는 리눅스 메모.md", "3. Resources/개발/떠도는 리눅스 메모.md"],
    ]);
    // 제안만으로는 아무것도 옮기지 않는다
    expect(fs.existsSync(path.join(root, "떠도는 리눅스 메모.md"))).toBe(true);
    expect(generateParaMoves(db)).toBe(0); // 같은 제안은 다시 만들지 않음
  });

  it("수락하면 옮기고(프로젝트 연결 유지), 거절한 제안은 다시 나오지 않는다", async () => {
    const { db, root, folderId } = await vault();
    const p = createProject(db, "로봇 대회", { status: "done" });
    linkFolder(db, p.id, folderId);
    generateParaMoves(db);
    const [archive, note] = ["archive", "note"].map((k) => pendingParaMoves(db).find((m) => m.kind === k)!);
    expect(acceptParaMove(db, archive.id).ok).toBe(true);
    expect(fs.existsSync(path.join(root, "4. Archives/로봇 대회/계획.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, "1. Projects/대회/로봇 대회"))).toBe(false);
    rejectParaMove(db, note.id);
    expect(generateParaMoves(db)).toBe(0);
    expect(fs.existsSync(path.join(root, "떠도는 리눅스 메모.md"))).toBe(true);
  });

  it("옮길 곳에 같은 이름이 생겼거나 볼트 밖이면 옮기지 않는다", async () => {
    const { db, root } = await vault();
    generateParaMoves(db);
    const note = pendingParaMoves(db)[0];
    write(root, "3. Resources/개발/떠도는 리눅스 메모.md", "이미 있음");
    const r = acceptParaMove(db, note.id);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch("같은 이름");
    expect(fs.readFileSync(path.join(root, "떠도는 리눅스 메모.md"), "utf8")).toBe("리눅스 명령어 메모");
    // 조작된 제안 (볼트 밖)
    const id = db
      .insert(paraMoves)
      .values({ kind: "note", fromPath: path.join(root, "떠도는 리눅스 메모.md"), toPath: path.join(root, "../밖.md"), reason: "x", createdAt: 1 })
      .returning()
      .get().id;
    expect(acceptParaMove(db, id).message).toMatch("볼트 밖");
    expect(fs.existsSync(path.join(root, "떠도는 리눅스 메모.md"))).toBe(true);
  });
});

describe("소스별 확장자 제한 (Claude Code 세션은 .jsonl 만)", () => {
  it("다른 파일은 색인하지 않고, 이미 들어간 것은 정리한다 (파일은 그대로)", async () => {
    const db = testDb();
    const root = tmpDir();
    write(root, "proj/a.jsonl", JSON.stringify({ type: "user", message: { role: "user", content: "안녕" } }));
    write(root, "proj/a/tool-results/shot.jpg", "jpg");
    write(root, "memory/MEMORY.md", "# 메모");
    const src = addSource(db, root);
    await runScan(db, src.id, deps());
    expect(db.select().from(items).all()).toHaveLength(3);
    db.update(sources).set({ config: { onlyExt: ["jsonl"] } }).where(eq(sources.id, src.id)).run();
    await runScan(db, src.id, deps());
    expect(db.select().from(items).all().map((i) => path.basename(i.path))).toEqual(["a.jsonl"]);
    expect(fs.existsSync(path.join(root, "memory/MEMORY.md"))).toBe(true);
  });
});

describe("PARA: 프로젝트·영역·자료·보관", () => {
  it("탭별로 나뉘고, 영역·자료는 쉬는 프로젝트 알림에서 빠지며, Obsidian 2. Areas 를 영역으로 가져온다", async () => {
    const { projectList } = await import("@/server/projects");
    const { previewParaImport, importPara } = await import("@/server/projects/para");
    const db = testDb();
    const root = tmpDir();
    const old = write(root, "2. Areas/진로/메모.md", "진로 메모");
    write(root, "2. Areas/보안/메모.md", "보안 메모");
    fs.utimesSync(old, new Date(Date.now() - 90 * DAY), new Date(Date.now() - 90 * DAY));
    const src = addSource(db, root, { kind: "obsidian" });
    await runScan(db, src.id, deps());
    const areas = path.join(root, "2. Areas");
    expect(previewParaImport(db, areas).map((r) => r.name).sort()).toEqual(["보안", "진로"]);
    importPara(db, previewParaImport(db, areas).map((r) => r.folderId), areas, "area");
    const p = createProject(db, "끝난 일", { kind: "project" });
    updateProject(db, p.id, { status: "done" });
    createProject(db, "개발", { kind: "resource" });
    expect(projectList(db, { tab: "area" }).map((x) => x.name).sort()).toEqual(["보안", "진로"]);
    expect(projectList(db, { tab: "resource" }).map((x) => x.name)).toEqual(["개발"]);
    expect(projectList(db, { tab: "archive" }).map((x) => x.name)).toEqual(["끝난 일"]);
    expect(projectList(db, { tab: "project" })).toHaveLength(0);
    // 90일 넘게 안 바뀐 영역이 있어도 알리지 않는다
    expect(staleProjects(db)).toHaveLength(0);
  });
});
