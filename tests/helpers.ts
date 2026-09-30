import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { openDb, type Db } from "@/server/db";
import { items, sources } from "@/server/db/schema";
import type { MountEnv } from "@/server/sources/availability";
import type { ScanDeps } from "@/server/sync/scanner";

export function tmpDir(prefix = "hub-test-") {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

export function testDb(): Db {
  return openDb(path.join(tmpDir(), "hub.db"));
}

/** 외장 디스크를 흉내 낸다: mounted 를 false 로 바꾸면 "분리됨" */
export function fakeVolume(root: string, uuid = "UUID-1") {
  const state = { mounted: true, uuid };
  const env: MountEnv = {
    isMountPoint: (p) => (p === root ? state.mounted : false),
    volumeUuid: (p) => (p === root && state.mounted ? state.uuid : undefined),
  };
  return { state, env };
}

export function deps(over: Partial<ScanDeps> = {}): ScanDeps & { reads: string[]; clock: { t: number } } {
  const reads: string[] = [];
  const clock = { t: Date.UTC(2026, 9, 1) };
  return {
    now: () => clock.t,
    mount: { isMountPoint: () => false, volumeUuid: () => undefined },
    isDataless: () => false,
    readFile: async (p) => {
      reads.push(p);
      return fs.promises.readFile(p);
    },
    ...over,
    reads,
    clock,
  };
}

export function addSource(db: Db, root: string, opts: { volumeRoot?: string; volumeUuid?: string; kind?: "external" | "icloud" | "obsidian" | "local" } = {}) {
  return db
    .insert(sources)
    .values({
      kind: opts.kind ?? (opts.volumeRoot ? "external" : "local"),
      name: path.basename(root),
      rootPath: root,
      volumeRoot: opts.volumeRoot ?? null,
      volumeUuid: opts.volumeUuid ?? null,
      createdAt: Date.now(),
    })
    .returning()
    .get();
}

export function write(root: string, rel: string, content = "내용") {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

export const itemByPath = (db: Db, p: string) => db.select().from(items).where(eq(items.path, p)).get();
export const allItems = (db: Db) => db.select().from(items).all();
