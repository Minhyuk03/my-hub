import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/config";
import type { Db } from "./db";
import { backups } from "./db/schema";
import { realMountEnv, type MountEnv } from "./sources/availability";
import { volumeRootOf } from "./sources/rules";

export const PENDING_DIR = path.join(DATA_DIR, "backups-pending");
const NAME_RE = /^hub-(\d{8})-(\d{6})\.db$/;

export type BackupEnv = {
  now: () => number;
  mount: MountEnv;
  pendingDir: string;
  /** 백업 폴더가 속한 볼륨 루트 (테스트에서 바꿔 끼움) */
  volumeRootOf?: (dir: string) => string | null;
};
export const realBackupEnv = (): BackupEnv => ({ now: Date.now, mount: realMountEnv, pendingDir: PENDING_DIR });

function stamp(ms: number) {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function parseStamp(name: string): number | null {
  const m = name.match(NAME_RE);
  if (!m) return null;
  const [, d, t] = m;
  return new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6)).getTime();
}

/** 백업 위치(외장 디스크)를 지금 쓸 수 있는지. 디스크가 분리된 상태에서 내장 디스크에 폴더를 만들지 않도록 확인한다. */
export function backupDirAvailable(dir: string, env: Pick<BackupEnv, "mount" | "volumeRootOf">): boolean {
  const vr = (env.volumeRootOf ?? volumeRootOf)(dir);
  if (vr) return env.mount.isMountPoint(vr);
  return fs.existsSync(path.dirname(dir));
}

/** SQLite 파일이 온전한지 확인 */
export function verifyDbFile(file: string): boolean {
  try {
    const c = new Database(file, { readonly: true, fileMustExist: true });
    const r = c.pragma("integrity_check", { simple: true });
    c.close();
    return r === "ok";
  } catch {
    return false;
  }
}

/**
 * 실행 중인 DB를 일관된 상태로 백업한다 (VACUUM INTO — 파일 단순 복사 아님).
 * 외장 디스크가 없으면 내장 디스크 임시 폴더에 두었다가, 나중에 flushPending 으로 옮긴다.
 */
export function createBackup(db: Db, dir: string, env: BackupEnv) {
  const now = env.now();
  const onDisk = backupDirAvailable(dir, env);
  const target = path.join(onDisk ? dir : env.pendingDir, `hub-${stamp(now)}.db`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) fs.rmSync(target);
  db.$client.prepare(`VACUUM INTO ?`).run(target);
  const ok = verifyDbFile(target);
  if (!ok) {
    fs.rmSync(target, { force: true });
    throw new Error("백업 파일 검증 실패");
  }
  const size = fs.statSync(target).size;
  db.insert(backups).values({ path: target, createdAt: now, size, verifiedAt: env.now(), location: onDisk ? "disk" : "pending" }).run();
  return { path: target, location: onDisk ? ("disk" as const) : ("pending" as const), size };
}

/** 임시 보관 중인 백업을 외장 디스크로 옮긴다 */
export function flushPending(db: Db, dir: string, env: BackupEnv): number {
  if (!backupDirAvailable(dir, env) || !fs.existsSync(env.pendingDir)) return 0;
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const name of fs.readdirSync(env.pendingDir)) {
    if (!NAME_RE.test(name)) continue;
    const from = path.join(env.pendingDir, name);
    const to = path.join(dir, name);
    fs.copyFileSync(from, to);
    if (!verifyDbFile(to)) {
      fs.rmSync(to, { force: true });
      continue;
    }
    fs.rmSync(from);
    db.$client.prepare(`UPDATE backups SET path = ?, location = 'disk' WHERE path = ?`).run(to, from);
    n++;
  }
  return n;
}

export function listBackups(dir: string): { name: string; path: string; createdAt: number; size: number }[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((name) => ({ name, createdAt: parseStamp(name) }))
    .filter((x): x is { name: string; createdAt: number } => x.createdAt != null)
    .map((x) => {
      const p = path.join(dir, x.name);
      return { ...x, path: p, size: fs.statSync(p).size };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

const dayKey = (ms: number) => stamp(ms).slice(0, 8);
function weekKey(ms: number) {
  // ISO 주 (월요일 시작)
  const d = new Date(ms);
  const day = (d.getDay() + 6) % 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return dayKey(d.getTime());
}

/** 보관할 백업을 고른다: 최근 날짜별 1개씩 keepDaily개 + 최근 주별 1개씩 keepWeekly개 */
export function selectRetained(list: { name: string; createdAt: number }[], keepDaily: number, keepWeekly: number): Set<string> {
  const keep = new Set<string>();
  const sorted = [...list].sort((a, b) => b.createdAt - a.createdAt);
  const days = new Set<string>();
  const weeks = new Set<string>();
  for (const b of sorted) {
    const d = dayKey(b.createdAt);
    if (!days.has(d) && days.size < keepDaily) {
      days.add(d);
      keep.add(b.name);
    }
  }
  for (const b of sorted) {
    const w = weekKey(b.createdAt);
    if (!weeks.has(w) && weeks.size < keepWeekly) {
      weeks.add(w);
      keep.add(b.name);
    }
  }
  return keep;
}

export function applyRetention(db: Db, dir: string, keepDaily: number, keepWeekly: number, now: number): string[] {
  const list = listBackups(dir);
  const keep = selectRetained(list, keepDaily, keepWeekly);
  const removed: string[] = [];
  for (const b of list) {
    if (keep.has(b.name)) continue;
    fs.rmSync(b.path, { force: true });
    db.$client.prepare(`UPDATE backups SET removed_at = ? WHERE path = ?`).run(now, b.path);
    removed.push(b.name);
  }
  return removed;
}

/**
 * 백업 파일로 DB를 되돌린다. 허브(웹·워커)를 멈춘 상태에서 실행해야 한다.
 * 현재 DB는 hub.db.before-restore-<시각> 으로 남겨 둔다.
 */
export function restoreBackup(backupFile: string, dbFile: string, now = Date.now()): { savedCurrent?: string } {
  if (!verifyDbFile(backupFile)) throw new Error("백업 파일이 손상되었거나 SQLite 파일이 아닙니다.");
  let savedCurrent: string | undefined;
  if (fs.existsSync(dbFile)) {
    savedCurrent = `${dbFile}.before-restore-${stamp(now)}`;
    try {
      const cur = new Database(dbFile);
      cur.prepare(`VACUUM INTO ?`).run(savedCurrent);
      cur.close();
    } catch {
      fs.copyFileSync(dbFile, savedCurrent); // 현재 DB가 손상된 경우
    }
  }
  for (const suffix of ["-wal", "-shm"]) fs.rmSync(dbFile + suffix, { force: true });
  const tmp = `${dbFile}.restoring`;
  fs.copyFileSync(backupFile, tmp);
  fs.renameSync(tmp, dbFile);
  if (!verifyDbFile(dbFile)) throw new Error("복원 후 검증 실패");
  return { savedCurrent };
}
