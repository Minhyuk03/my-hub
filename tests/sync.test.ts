import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { folders, itemErrors, items, scanJobs, sources } from "@/server/db/schema";
import { search } from "@/server/search/query";
import { RETRY_DELAYS_MS, purgeDeleted, recordError, retryDue, runScan } from "@/server/sync/scanner";
import { addSource, allItems, deps, fakeVolume, itemByPath, testDb, tmpDir, write } from "./helpers";

describe("동기화 규칙 (5장)", () => {
  it("첫 스캔: 파일을 인덱싱하고 제외 패턴·숨김 파일은 건너뛴다", async () => {
    const db = testDb();
    const root = tmpDir();
    write(root, "노트/회의록.md", "# 주간 회의\n#회의 태그");
    write(root, "node_modules/x/index.js", "x");
    write(root, ".env", "SECRET=1");
    write(root, "사진.png", "png");
    const src = addSource(db, root);
    const r = await runScan(db, src.id, deps());
    expect(r.result).toBe("ok");
    const names = allItems(db).map((i) => path.basename(i.path)).sort();
    expect(names).toEqual(["사진.png", "회의록.md"]);
  });

  it("NFD 한글 파일 이름도 NFC 검색어로 찾는다", async () => {
    const db = testDb();
    const root = tmpDir();
    write(root, "주간회의록.txt".normalize("NFD"), "");
    const src = addSource(db, root);
    await runScan(db, src.id, deps());
    expect(search(db, "회의").hits.map((h) => h.title)).toEqual(["주간회의록.txt"]);
  });

  it("iCloud에만 있는(dataless) 파일은 읽지 않고 cloud_only 로 둔다", async () => {
    const db = testDb();
    const root = tmpDir();
    const p = write(root, "원격.md", "본문");
    const src = addSource(db, root, { kind: "icloud" });
    const d = deps({ isDataless: (fp) => fp === p });
    await runScan(db, src.id, d);
    expect(d.reads).not.toContain(p);
    expect(itemByPath(db, p)?.state).toBe("cloud_only");
    // 제목으로는 검색된다
    expect(search(db, "원격").hits).toHaveLength(1);
  });

  it("디스크를 분리하면 삭제하지 않고 오프라인으로 표시한다", async () => {
    const db = testDb();
    const vol = tmpDir("vol-");
    const root = path.join(vol, "Docs");
    write(root, "a.md", "알파 문서");
    const fv = fakeVolume(vol);
    const src = addSource(db, root, { volumeRoot: vol, volumeUuid: "UUID-1" });
    await runScan(db, src.id, deps({ mount: fv.env }));

    fv.state.mounted = false;
    // 분리 후 같은 이름의 빈 폴더가 남은 상황
    fs.rmSync(root, { recursive: true });
    fs.mkdirSync(root);
    const r = await runScan(db, src.id, deps({ mount: fv.env }));
    expect(r.result).toBe("offline");
    expect(allItems(db).every((i) => i.state === "ok")).toBe(true);
    expect(db.select().from(sources).get()?.status).toBe("offline");
    const hit = search(db, "알파").hits[0];
    expect(hit.sourceStatus).toBe("offline");
  });

  it("같은 이름의 다른 디스크가 연결되면 오프라인으로 본다", async () => {
    const db = testDb();
    const vol = tmpDir("vol-");
    const root = path.join(vol, "Docs");
    write(root, "a.md");
    const fv = fakeVolume(vol, "UUID-OTHER");
    const src = addSource(db, root, { volumeRoot: vol, volumeUuid: "UUID-1" });
    const r = await runScan(db, src.id, deps({ mount: fv.env }));
    expect(r.result).toBe("offline");
    expect(allItems(db)).toHaveLength(0);
  });

  it("전체 스캔이 성공해야만 사라진 파일을 deleted 로 표시한다", async () => {
    const db = testDb();
    const root = tmpDir();
    const a = write(root, "a.md", "사라질 문서");
    write(root, "b.md");
    const src = addSource(db, root);
    await runScan(db, src.id, deps());
    expect(search(db, "사라질").hits).toHaveLength(1);
    fs.rmSync(a);
    const r = await runScan(db, src.id, deps());
    expect(r.message).toBeUndefined();
    expect(r.deleted).toBe(1);
    expect(itemByPath(db, a)?.state).toBe("deleted");
    expect(search(db, "사라질").hits).toHaveLength(0);
  });

  it("스캔이 중간에 멈추면 삭제 판단을 하지 않고, 다음에 이어서 한다", async () => {
    const db = testDb();
    const root = tmpDir();
    for (let i = 0; i < 5; i++) write(root, `d${i}/f.md`, `파일 ${i}`);
    const src = addSource(db, root);
    await runScan(db, src.id, deps());
    fs.rmSync(path.join(root, "d0"), { recursive: true });

    let calls = 0;
    const r1 = await runScan(db, src.id, deps({ shouldAbort: () => ++calls > 2 }));
    expect(r1.result).toBe("aborted");
    expect(allItems(db).filter((i) => i.state === "deleted")).toHaveLength(0);
    const job = db.select().from(scanJobs).where(eq(scanJobs.id, r1.jobId!)).get()!;
    expect(JSON.parse(job.cursor!).stack.length).toBeGreaterThan(0);

    const d2 = deps();
    const r2 = await runScan(db, src.id, d2);
    expect(r2.jobId).toBe(r1.jobId); // 같은 작업을 이어서 함
    expect(r2.result).toBe("ok");
    expect(allItems(db).filter((i) => i.state === "deleted")).toHaveLength(1);
    // 이미 확인한 폴더는 다시 읽지 않음
    expect(d2.reads.length).toBeLessThan(5);
  });

  it("스캔 도중 디스크가 분리되면 삭제 판단 없이 오프라인 처리", async () => {
    const db = testDb();
    const vol = tmpDir("vol-");
    const root = path.join(vol, "Docs");
    for (let i = 0; i < 3; i++) write(root, `d${i}/f.md`);
    const fv = fakeVolume(vol);
    const src = addSource(db, root, { volumeRoot: vol, volumeUuid: "UUID-1" });
    await runScan(db, src.id, deps({ mount: fv.env }));
    let n = 0;
    const d = deps({
      mount: fv.env,
      onProgress: () => {
        if (++n === 1) fv.state.mounted = false;
      },
    });
    const r = await runScan(db, src.id, d);
    expect(r.result).toBe("offline");
    expect(allItems(db).every((i) => i.state === "ok")).toBe(true);
  });

  it("이름 변경·이동은 같은 항목(id)으로 유지된다 (inode)", async () => {
    const db = testDb();
    const root = tmpDir();
    const a = write(root, "old/계획.md", "블로그 계획");
    const src = addSource(db, root);
    await runScan(db, src.id, deps());
    const before = itemByPath(db, a)!;
    const folderBefore = db.select().from(folders).where(eq(folders.path, path.join(root, "old"))).get()!;
    fs.renameSync(path.join(root, "old"), path.join(root, "new"));
    await runScan(db, src.id, deps());
    const after = itemByPath(db, path.join(root, "new/계획.md"))!;
    expect(after.id).toBe(before.id);
    expect(allItems(db).filter((i) => i.state === "deleted")).toHaveLength(0);
    const folderAfter = db.select().from(folders).where(eq(folders.path, path.join(root, "new"))).get()!;
    expect(folderAfter.id).toBe(folderBefore.id);
  });

  it("다른 소스로 복사 이동돼 inode가 바뀌어도 내용 해시로 같은 항목을 유지한다", async () => {
    const db = testDb();
    const r1 = tmpDir();
    const r2 = tmpDir();
    const a = write(r1, "문서.md", "고유한 내용 12345");
    const s1 = addSource(db, r1);
    const s2 = addSource(db, r2);
    await runScan(db, s1.id, deps());
    const id = itemByPath(db, a)!.id;
    fs.copyFileSync(a, path.join(r2, "문서.md"));
    fs.rmSync(a);
    await runScan(db, s2.id, deps());
    const moved = itemByPath(db, path.join(r2, "문서.md"))!;
    expect(moved.id).toBe(id);
    expect(moved.sourceId).toBe(s2.id);
  });

  it("삭제된 폴더는 지우지 않고 deleted 로 남긴다 (프로젝트 연결 '폴더 없음' 경고용)", async () => {
    const db = testDb();
    const root = tmpDir();
    write(root, "sub/x.md");
    const src = addSource(db, root);
    await runScan(db, src.id, deps());
    fs.rmSync(path.join(root, "sub"), { recursive: true });
    await runScan(db, src.id, deps());
    expect(db.select().from(folders).where(eq(folders.path, path.join(root, "sub"))).get()?.state).toBe("deleted");
  });

  it("deleted 항목은 보관 기간(30일)이 지나야 실제로 지운다", async () => {
    const db = testDb();
    const root = tmpDir();
    const a = write(root, "a.md");
    const src = addSource(db, root);
    const d = deps();
    await runScan(db, src.id, d);
    fs.rmSync(a);
    await runScan(db, src.id, d);
    purgeDeleted(db, d.clock.t + 29 * 86400_000, 30);
    expect(itemByPath(db, a)).toBeDefined();
    purgeDeleted(db, d.clock.t + 31 * 86400_000, 30);
    expect(itemByPath(db, a)).toBeUndefined();
  });

  it("읽지 못한 폴더 아래 항목은 삭제로 판단하지 않는다", async () => {
    const db = testDb();
    const root = tmpDir();
    const a = write(root, "locked/a.md");
    const src = addSource(db, root);
    await runScan(db, src.id, deps());
    fs.chmodSync(path.join(root, "locked"), 0o000);
    try {
      const r = await runScan(db, src.id, deps());
      expect(r.result).toBe("ok");
      expect(itemByPath(db, a)?.state).toBe("ok");
    } finally {
      fs.chmodSync(path.join(root, "locked"), 0o755);
    }
  });

  it("추출 실패는 점점 긴 간격으로 재시도하고, 계속 실패하면 오류 목록에 남는다", async () => {
    const db = testDb();
    const root = tmpDir();
    const p = write(root, "깨진.pdf", "not a pdf");
    const src = addSource(db, root);
    const d = deps();
    await runScan(db, src.id, d);
    const it = itemByPath(db, p)!;
    expect(it.state).toBe("extract_failed");
    let err = db.select().from(itemErrors).where(eq(itemErrors.itemId, it.id)).get()!;
    expect(err.nextRetryAt).toBe(d.clock.t + RETRY_DELAYS_MS[0]);
    for (let i = 1; i <= RETRY_DELAYS_MS.length; i++) {
      d.clock.t = err.nextRetryAt!;
      await retryDue(db, d);
      err = db.select().from(itemErrors).where(eq(itemErrors.itemId, it.id)).get()!;
      expect(err.retryCount).toBe(i);
    }
    expect(err.nextRetryAt).toBeNull(); // 더 이상 자동 재시도 안 함
    expect(itemByPath(db, p)?.state).toBe("extract_failed"); // 메타데이터는 유지
  });

  it("재시도 간격 계산", () => {
    const db = testDb();
    const root = tmpDir();
    const src = addSource(db, root);
    const it = db.insert(items).values({ sourceId: src.id, path: "/x", title: "x" }).returning().get();
    recordError(db, it.id, { kind: "extract", message: "e" }, 0);
    recordError(db, it.id, { kind: "extract", message: "e" }, 1000);
    const err = db.select().from(itemErrors).get()!;
    expect(err.retryCount).toBe(1);
    expect(err.nextRetryAt).toBe(1000 + RETRY_DELAYS_MS[1]);
  });

  it("다른 소스 안에 등록된 폴더의 파일은 한 번만 인덱싱한다", async () => {
    const db = testDb();
    const root = tmpDir();
    write(root, "a.md");
    write(root, "inner/b.md");
    const outer = addSource(db, root);
    const inner = addSource(db, path.join(root, "inner"));
    await runScan(db, outer.id, deps());
    await runScan(db, inner.id, deps());
    const b = allItems(db).filter((i) => i.path.endsWith("b.md"));
    expect(b).toHaveLength(1);
    expect(b[0].sourceId).toBe(inner.id);
  });

  it("변경 없는 파일은 다시 읽지 않는다", async () => {
    const db = testDb();
    const root = tmpDir();
    write(root, "a.md");
    const src = addSource(db, root);
    await runScan(db, src.id, deps());
    const d = deps();
    await runScan(db, src.id, d);
    expect(d.reads).toHaveLength(0);
  });

  it("Obsidian 태그와 위키링크를 저장하고 태그로 필터한다", async () => {
    const db = testDb();
    const root = tmpDir();
    write(root, "노트.md", "---\ntags: [블로그, 기획]\n---\n본문 #아이디어 [[다른 노트|별칭]]");
    write(root, "다른.md", "본문");
    const src = addSource(db, root, { kind: "obsidian" });
    await runScan(db, src.id, deps());
    expect(search(db, "본문", { tag: "아이디어" }).hits.map((h) => h.title)).toEqual(["노트"]);
    expect(search(db, "본문", { tag: "블로그" }).hits).toHaveLength(1);
    const links = db.$client.prepare("select target from item_links").pluck().all();
    expect(links).toEqual(["다른 노트"]);
  });
});

describe("제외 규칙 적용", () => {
  it("터미널식 경로로 입력한 한글(NFD) 제외 폴더도 적용되고, 색인에서 빠진다(삭제 표시 아님)", async () => {
    const { purgeExcluded } = await import("@/server/sync/scanner");
    const { setSetting, getSettings } = await import("@/server/settings");
    const db = testDb();
    const root = tmpDir("my ");
    write(root, "일정관리".normalize("NFD") + "/daily.md", "일정");
    write(root, "노트.md", "노트");
    const src = addSource(db, root);
    await runScan(db, src.id, deps());
    expect(allItems(db)).toHaveLength(2);
    setSetting(db, "excludedFolders", [`${root.replace(/ /g, "\\ ")}/일정관리`]);
    expect(getSettings(db).excludedFolders).toContain(`${root}/일정관리`);
    expect(purgeExcluded(db)).toBe(1);
    const r = await runScan(db, src.id, deps());
    expect(r.deleted).toBe(0);
    expect(allItems(db).map((i) => i.title)).toEqual(["노트"]);
  });
});
