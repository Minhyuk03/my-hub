import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { isDataless, isMaterializeRefused } from "@/lib/fs/dataless";
import { eq } from "drizzle-orm";
import { sources } from "@/server/db/schema";
import { search } from "@/server/search/query";
import { runScan } from "@/server/sync/scanner";
import { addSource, deps, itemByPath, testDb, tmpDir, write } from "./helpers";

describe("iCloud 에만 있는 파일 (백그라운드 실행)", () => {
  it("백그라운드 읽기 거절(errno 11)은 오류가 아니라 cloud_only 로 둔다", async () => {
    const db = testDb();
    const root = tmpDir();
    const p = write(root, "원격.md", "본문");
    const src = addSource(db, root, { kind: "icloud" });
    const refused = Object.assign(new Error("Unknown system error -11"), { errno: -11, code: "Unknown system error -11" });
    await runScan(db, src.id, deps({ readFile: async () => Promise.reject(refused) }));
    expect(itemByPath(db, p)?.state).toBe("cloud_only");
    expect(db.$client.prepare("select count(*) from item_errors").pluck().get()).toBe(0);
  });

  it("본문을 색인한 파일이 iCloud 로 내려가도(evict) 색인은 유지한다", async () => {
    const db = testDb();
    const root = tmpDir();
    const p = write(root, "노트.md", "유지될 본문");
    const src = addSource(db, root, { kind: "icloud" });
    await runScan(db, src.id, deps());
    const d = deps({ isDataless: (fp) => fp === p });
    await runScan(db, src.id, d);
    expect(d.reads).toHaveLength(0);
    expect(itemByPath(db, p)?.state).toBe("ok");
    expect(search(db, "유지될").hits).toHaveLength(1);
  });

  it("'텍스트 파일 내려받기'를 켠 소스만 작은 텍스트 파일을 내려받아 색인한다", async () => {
    const db = testDb();
    const root = tmpDir();
    const note = write(root, "노트.md", "받아온 본문 #태그");
    const img = write(root, "사진.png", "png");
    const materialized: string[] = [];
    const mk = () =>
      deps({
        isDataless: (fp) => !materialized.includes(fp) && (fp === note || fp === img),
        materialize: async (fp) => {
          materialized.push(fp);
          return true;
        },
      });
    const off = addSource(db, root, { kind: "obsidian" });
    await runScan(db, off.id, mk());
    expect(materialized).toHaveLength(0);
    expect(itemByPath(db, note)?.state).toBe("cloud_only");

    db.update(sources).set({ config: { downloadText: true } }).where(eq(sources.id, off.id)).run();
    await runScan(db, off.id, mk());
    expect(materialized).toEqual([note]); // 이미지는 받지 않음
    expect(itemByPath(db, note)?.state).toBe("ok");
    expect(search(db, "받아온").hits).toHaveLength(1);
  });

  it("거절 오류 판별", () => {
    expect(isMaterializeRefused({ errno: -11 })).toBe(true);
    expect(isMaterializeRefused({ code: "EDEADLK" })).toBe(true);
    expect(isMaterializeRefused({ code: "ENOENT", errno: -2 })).toBe(false);
  });

  it("파일 플래그를 읽지 못하면 내려받지 않은 파일로 본다 (확실하지 않으면 읽지 않음)", () => {
    const fake = { isFile: () => true, size: 100, blocks: 0 } as fs.Stats;
    expect(isDataless("/존재하지/않는/파일", fake)).toBe(true);
  });

  it("스캔은 심볼릭 링크를 인덱싱하지 않는다", async () => {
    const db = testDb();
    const root = tmpDir();
    const real = write(root, "a.md", "x");
    fs.symlinkSync(real, `${root}/link.md`);
    const src = addSource(db, root);
    await runScan(db, src.id, deps());
    expect(itemByPath(db, `${root}/link.md`)).toBeUndefined();
  });
});
