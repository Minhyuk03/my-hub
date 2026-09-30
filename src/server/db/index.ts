import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/config";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

export const DB_FILE = process.env.HUB_DB_FILE ?? path.join(DATA_DIR, "hub.db");
const MIGRATIONS = path.join(process.env.HUB_ROOT ?? process.cwd(), "drizzle");

/** DB를 열고 마이그레이션을 적용한다. 테스트에서는 임시 파일 경로를 넘긴다. */
export function openDb(file: string = DB_FILE, opts: { migrate?: boolean } = {}): Db {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema }) as Db;
  if (opts.migrate !== false) migrate(db, { migrationsFolder: MIGRATIONS });
  return db;
}

const g = globalThis as unknown as { __hubDb?: Db };

/** 웹 서버 프로세스용 공유 연결 */
export function getDb(): Db {
  // 마이그레이션은 npm run migrate(허브 시작 시)와 워커가 담당한다
  if (!g.__hubDb) g.__hubDb = openDb(DB_FILE, { migrate: false });
  return g.__hubDb;
}

export { schema };
