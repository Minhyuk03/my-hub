/**
 * 백업에서 DB를 복원한다.
 *   npm run restore -- <백업 파일 경로>
 *   npm run restore -- --list      (백업 목록 보기)
 * 허브(웹·워커)를 먼저 멈춘 뒤 실행한다.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { listBackups, PENDING_DIR, restoreBackup } from "@/server/backup";
import { DB_FILE } from "@/server/db";
import { DEFAULT_SETTINGS } from "@/server/settings";

function backupDir(): string {
  try {
    const c = new Database(DB_FILE, { readonly: true, fileMustExist: true });
    const row = c.prepare(`SELECT value FROM settings WHERE key = 'backupDir'`).get() as { value: string } | undefined;
    c.close();
    if (row) return JSON.parse(row.value);
  } catch {}
  return DEFAULT_SETTINGS.backupDir;
}

function workerRunning(): number | null {
  try {
    const c = new Database(DB_FILE, { readonly: true, fileMustExist: true });
    const row = c.prepare(`SELECT value, updated_at FROM runtime WHERE key = 'worker'`).get() as { value: string; updated_at: number } | undefined;
    c.close();
    if (!row) return null;
    const v = JSON.parse(row.value);
    return v.pid && Date.now() - row.updated_at < 15_000 ? v.pid : null;
  } catch {
    return null;
  }
}

const arg = process.argv[2];
if (!arg || arg === "--list") {
  const dirs = [backupDir(), PENDING_DIR];
  for (const d of dirs) {
    const list = listBackups(d);
    console.log(`\n${d} (${list.length}개)`);
    for (const b of list) console.log(`  ${new Date(b.createdAt).toLocaleString("ko-KR")}  ${(b.size / 1048576).toFixed(1)}MB  ${b.path}`);
  }
  console.log("\n복원: npm run restore -- <백업 파일 경로>");
  process.exit(0);
}

const file = path.resolve(arg);
if (!fs.existsSync(file)) {
  console.error("백업 파일이 없습니다:", file);
  process.exit(1);
}
const pid = workerRunning();
if (pid && !process.argv.includes("--force")) {
  console.error(`허브 워커가 실행 중입니다 (pid ${pid}). 먼저 허브를 멈춘 뒤 다시 실행하세요.`);
  process.exit(1);
}
const r = restoreBackup(file, DB_FILE);
console.log("복원 완료:", DB_FILE);
if (r.savedCurrent) console.log("복원 전 DB 보관:", r.savedCurrent);
