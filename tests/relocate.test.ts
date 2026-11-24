import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { commands, folders, projectFolders, sources } from "@/server/db/schema";
import { resolveItemFile } from "@/server/items/access";
import { createProject, linkFolder } from "@/server/projects";
import { search } from "@/server/search/query";
import { getSettings, setSetting } from "@/server/settings";
import { relocateSource } from "@/server/sources/manage";
import { runScan } from "@/server/sync/scanner";
import { addSource, allItems, deps, itemByPath, testDb, tmpDir, write } from "./helpers";

const noMount = { isMountPoint: () => false, volumeUuid: () => undefined };

/** 폴더를 만들어 색인한 뒤 다른 곳으로 옮긴다 (같은 디스크 안 이동이라 inode 유지) */
async function movedSource() {
  const db = testDb();
  const base = tmpDir("reloc-");
  const oldRoot = path.join(base, "Desktop", "KMOU");
  write(oldRoot, "1학년/과제.md", "자료구조 과제");
  write(oldRoot, "2학년/보고서.md", "운영체제 보고서");
  write(oldRoot, "기타/메모.md", "메모 내용");
  const src = addSource(db, oldRoot, { kind: "icloud" });
  await runScan(db, src.id, deps());
  const newRoot = path.join(base, "Documents", "KMOU");
  fs.mkdirSync(path.dirname(newRoot), { recursive: true });
  fs.renameSync(oldRoot, newRoot);
  expect((await runScan(db, src.id, deps())).result).toBe("offline");
  return { db, src, oldRoot, newRoot };
}

describe("소스 위치 바꾸기", () => {
  it("폴더 없음 상태에서는 원본을 열지 않는다", async () => {
    const { db, src, oldRoot } = await movedSource();
    expect(db.select().from(sources).where(eq(sources.id, src.id)).get()!.status).toBe("error");
    const r = resolveItemFile(db, itemByPath(db, path.join(oldRoot, "1학년/과제.md"))!.id);
    expect(r.ok).toBe(false);
  });

  it("항목 ID·프로젝트 연결을 유지한 채 새 위치로 옮기고, 경로 검색 색인도 바꾼다", async () => {
    const { db, src, oldRoot, newRoot } = await movedSource();
    const before = itemByPath(db, path.join(oldRoot, "1학년/과제.md"))!;
    const fid = db.select().from(folders).where(eq(folders.path, path.join(oldRoot, "1학년"))).get()!.id;
    const p = createProject(db, "자료구조");
    linkFolder(db, p.id, fid);

    const r = relocateSource(db, src.id, newRoot, noMount);
    expect(r.moved).toBe(3);
    const after = itemByPath(db, path.join(newRoot, "1학년/과제.md"))!;
    expect(after.id).toBe(before.id);
    expect(db.select().from(folders).where(eq(folders.id, fid)).get()!.path).toBe(path.join(newRoot, "1학년"));
    expect(db.select().from(projectFolders).all()).toHaveLength(1);
    const s = db.select().from(sources).where(eq(sources.id, src.id)).get()!;
    expect([s.rootPath, s.status, s.name]).toEqual([newRoot, "ok", "KMOU"]);
    expect(db.select().from(commands).all().some((c) => c.kind === "source_moved")).toBe(true);
    // 경로 검색: 새 경로로 찾히고 옛 경로로는 안 찾힌다
    expect(search(db, "Documents").hits.map((h) => h.id)).toContain(before.id);
    expect(search(db, "Desktop").hits).toHaveLength(0);
    // 다시 스캔해도 새로 만들거나 삭제로 표시하지 않는다
    const scan = await runScan(db, src.id, deps());
    expect(scan.result).toBe("ok");
    expect(allItems(db).map((i) => i.state)).toEqual(["ok", "ok", "ok"]);
  });

  it("옮기면서 다른 하위 폴더로 간 파일은 inode 로 이어 붙인다", async () => {
    const { db, src, oldRoot, newRoot } = await movedSource();
    const before = itemByPath(db, path.join(oldRoot, "기타/메모.md"))!;
    fs.mkdirSync(path.join(newRoot, "활동"));
    fs.renameSync(path.join(newRoot, "기타/메모.md"), path.join(newRoot, "활동/메모.md"));
    relocateSource(db, src.id, newRoot, noMount);
    await runScan(db, src.id, deps());
    const after = itemByPath(db, path.join(newRoot, "활동/메모.md"))!;
    expect(after.id).toBe(before.id);
    expect(after.state).toBe("ok");
  });

  it("한글 경로가 NFD(macOS 파일 이름)여도 같은 항목으로 이어지고, 하나도 삭제로 표시하지 않는다", async () => {
    const db = testDb();
    const base = tmpDir("reloc-nfd-");
    const nfd = (s: string) => s.normalize("NFD");
    const oldRoot = path.join(base, nfd("바탕화면"), nfd("학교"));
    write(oldRoot, nfd("1학년/과제 정리.md"), "자료구조 과제");
    write(oldRoot, nfd("기타 자료/메모.md"), "메모 내용");
    const src = addSource(db, oldRoot, { kind: "icloud" });
    await runScan(db, src.id, deps());
    const ids = allItems(db).map((i) => i.id).sort();
    const newRoot = path.join(base, nfd("문서"), nfd("학교"));
    fs.mkdirSync(path.dirname(newRoot), { recursive: true });
    fs.renameSync(oldRoot, newRoot);
    await runScan(db, src.id, deps());

    relocateSource(db, src.id, newRoot, noMount);
    const scan = await runScan(db, src.id, deps());
    expect(scan.result).toBe("ok");
    expect(scan.deleted ?? 0).toBe(0);
    expect(allItems(db).map((i) => i.id).sort()).toEqual(ids);
    expect(allItems(db).every((i) => i.state === "ok" && i.path.startsWith(newRoot + "/"))).toBe(true);
  });

  it("제외 폴더·민감 정보로 숨긴 곳도 새 위치를 따라간다", async () => {
    const { db, src, oldRoot, newRoot } = await movedSource();
    setSetting(db, "sensitivePaths", [path.join(oldRoot, "2학년")]);
    setSetting(db, "excludedFolders", [path.join(oldRoot, "기타")]);
    relocateSource(db, src.id, newRoot, noMount);
    expect(getSettings(db).sensitivePaths).toEqual([path.join(newRoot, "2학년")]);
    expect(getSettings(db).excludedFolders).toEqual([path.join(newRoot, "기타")]);
  });

  it("원래 위치에 폴더가 아직 있거나, 다른 소스와 겹치면 바꾸지 않는다", async () => {
    const db = testDb();
    const root = tmpDir("reloc-ok-");
    write(root, "a.md", "a");
    const src = addSource(db, root);
    const elsewhere = tmpDir("reloc-copy-");
    expect(() => relocateSource(db, src.id, elsewhere, noMount)).toThrow("원래 위치에 폴더가 아직 있습니다");

    const { db: db2, src: moved, newRoot } = await movedSource();
    const inner = path.join(newRoot, "1학년");
    addSource(db2, path.join(path.dirname(newRoot)));
    expect(() => relocateSource(db2, moved.id, inner, noMount)).toThrow("겹치는");
    expect(db2.select().from(sources).where(eq(sources.id, moved.id)).get()!.status).toBe("error");
  });
});
