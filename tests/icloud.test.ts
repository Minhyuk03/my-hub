import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { isDataless, isMaterializeRefused } from "@/lib/fs/dataless";
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
