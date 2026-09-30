import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyRetention, createBackup, flushPending, listBackups, restoreBackup, selectRetained, verifyDbFile } from "@/server/backup";
import { openDb } from "@/server/db";
import { items } from "@/server/db/schema";
import { addSource, fakeVolume, tmpDir } from "./helpers";

function setup() {
  const dir = tmpDir();
  const dbFile = path.join(dir, "hub.db");
  const db = openDb(dbFile);
  const src = addSource(db, dir);
  db.insert(items).values({ sourceId: src.id, path: "/a", title: "첫 항목" }).run();
  const vol = tmpDir("vol-");
  const fv = fakeVolume(vol);
  const clock = { t: new Date(2026, 9, 1, 4, 0, 0).getTime() };
  const env = { now: () => clock.t, mount: fv.env, pendingDir: path.join(dir, "pending"), volumeRootOf: () => vol };
  return { dir, dbFile, db, vol, fv, clock, env, backupDir: path.join(vol, "hub-backups") };
}

describe("백업·복원 (8장)", () => {
  it("실행 중인 DB를 VACUUM INTO 로 백업하고, 첫 백업 때 폴더를 만든다", () => {
    const s = setup();
    expect(fs.existsSync(s.backupDir)).toBe(false);
    const b = createBackup(s.db, s.backupDir, s.env);
    expect(b.location).toBe("disk");
    expect(verifyDbFile(b.path)).toBe(true);
    const c = new Database(b.path, { readonly: true });
    expect(c.prepare("select title from items").pluck().get()).toBe("첫 항목");
    c.close();
  });

  it("외장 디스크가 없으면 내장 디스크에 임시 보관하고, 연결되면 옮긴다", () => {
    const s = setup();
    s.fv.state.mounted = false;
    const b = createBackup(s.db, s.backupDir, s.env);
    expect(b.location).toBe("pending");
    expect(fs.existsSync(s.backupDir)).toBe(false); // 분리 상태에서 폴더를 만들지 않음
    s.fv.state.mounted = true;
    expect(flushPending(s.db, s.backupDir, s.env)).toBe(1);
    expect(listBackups(s.backupDir)).toHaveLength(1);
    expect(fs.readdirSync(s.env.pendingDir)).toHaveLength(0);
  });

  it("보관 정책: 일간 14개 + 주간 8개", () => {
    const day = 86400_000;
    const start = new Date(2026, 0, 1, 4).getTime();
    const list = Array.from({ length: 100 }, (_, i) => ({ name: `b${i}`, createdAt: start + i * day }));
    const keep = selectRetained(list, 14, 8);
    // 최근 14일 + 그 이전 주들에서 추가로 보관되는 주간 백업
    const recent = list.slice(-14).map((b) => b.name);
    expect(recent.every((n) => keep.has(n))).toBe(true);
    expect(keep.size).toBeGreaterThanOrEqual(14);
    expect(keep.size).toBeLessThanOrEqual(22);
    expect(keep.has("b0")).toBe(false);
  });

  it("보관 정책 적용 시 오래된 백업 파일을 지운다", () => {
    const s = setup();
    for (let i = 0; i < 20; i++) {
      createBackup(s.db, s.backupDir, s.env);
      s.clock.t += 86400_000;
    }
    const removed = applyRetention(s.db, s.backupDir, 14, 8, s.clock.t);
    expect(removed.length).toBeGreaterThan(0);
    expect(listBackups(s.backupDir).length).toBe(20 - removed.length);
  });

  it("백업에서 복원하면 데이터가 백업 시점으로 돌아가고, 현재 DB는 따로 남긴다", () => {
    const s = setup();
    const b = createBackup(s.db, s.backupDir, s.env);
    s.db.insert(items).values({ sourceId: 1, path: "/b", title: "백업 이후 항목" }).run();
    s.db.$client.close();
    const r = restoreBackup(b.path, s.dbFile);
    expect(r.savedCurrent && fs.existsSync(r.savedCurrent)).toBeTruthy();
    const db2 = openDb(s.dbFile);
    const titles = db2.select().from(items).all().map((i) => i.title);
    expect(titles).toEqual(["첫 항목"]);
    // 복원 전 DB에는 이후 항목이 남아 있다
    const old = new Database(r.savedCurrent!, { readonly: true });
    expect(old.prepare("select count(*) from items").pluck().get()).toBe(2);
    old.close();
    // 복원한 DB에서도 검색 색인이 동작한다
    expect(db2.$client.prepare("select count(*) from items_fts").pluck().get()).toBeGreaterThanOrEqual(0);
  });

  it("손상된 백업 파일로는 복원하지 않는다", () => {
    const s = setup();
    const bad = path.join(s.dir, "hub-20260101-000000.db");
    fs.writeFileSync(bad, "not sqlite");
    expect(() => restoreBackup(bad, s.dbFile)).toThrow();
  });
});
