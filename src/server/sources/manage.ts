import fs from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { PATHS } from "@/lib/config";
import type { Db } from "../db";
import { commands, items, sources } from "../db/schema";
import { getSettings } from "../settings";
import { realMountEnv, type MountEnv } from "./availability";
import { checkNewSource, type SourceCheck } from "./rules";

export function sourceRoots(db: Db) {
  return db.select({ rootPath: sources.rootPath }).from(sources).all().map((r) => r.rootPath);
}

export function previewNewSource(db: Db, p: string): SourceCheck {
  return checkNewSource(p, { existingRoots: sourceRoots(db), excludedFolders: getSettings(db).excludedFolders });
}

export function createSource(db: Db, p: string, mount: MountEnv = realMountEnv, name?: string) {
  const check = previewNewSource(db, p);
  if (!check.ok) throw new Error(check.error);
  const realPath = check.realPath!;
  const volumeRoot = check.volumeRoot ?? null;
  const row = db
    .insert(sources)
    .values({
      kind: check.kind!,
      name: name ?? defaultName(realPath, check.kind!),
      rootPath: realPath,
      volumeRoot,
      volumeUuid: volumeRoot ? (mount.volumeUuid(volumeRoot) ?? null) : null,
      createdAt: Date.now(),
    })
    .returning()
    .get();
  enqueue(db, "source_added", { sourceId: row.id });
  return { source: row, warnings: check.warnings };
}

function defaultName(realPath: string, kind: string) {
  if (kind === "obsidian" && realPath === PATHS.obsidianVault) return "Obsidian 볼트";
  const base = path.basename(realPath).normalize("NFC");
  if (kind === "external") return `${base} (${realPath.split("/")[2]})`;
  if (kind === "icloud") return `${base} (iCloud)`;
  return base;
}

/** 소스 등록 해제: 인덱스에서만 지운다. 실제 파일은 건드리지 않는다. */
export function removeSource(db: Db, sourceId: number) {
  db.transaction((tx) => {
    tx.run(sql`DELETE FROM item_text WHERE item_id IN (SELECT id FROM items WHERE source_id = ${sourceId})`);
    tx.run(sql`DELETE FROM items_bigram WHERE rowid IN (SELECT id FROM items WHERE source_id = ${sourceId})`);
    tx.run(sql`DELETE FROM item_tags WHERE item_id IN (SELECT id FROM items WHERE source_id = ${sourceId})`);
    tx.run(sql`DELETE FROM item_tags_manual WHERE item_id IN (SELECT id FROM items WHERE source_id = ${sourceId})`);
    tx.run(sql`DELETE FROM item_embeddings WHERE item_id IN (SELECT id FROM items WHERE source_id = ${sourceId})`);
    tx.run(sql`DELETE FROM vec_chunks WHERE chunk_id IN (SELECT c.id FROM item_chunks c JOIN items i ON i.id = c.item_id WHERE i.source_id = ${sourceId})`);
    tx.run(sql`DELETE FROM item_chunks WHERE item_id IN (SELECT id FROM items WHERE source_id = ${sourceId})`);
    tx.run(sql`DELETE FROM item_chunk_state WHERE item_id IN (SELECT id FROM items WHERE source_id = ${sourceId})`);
    tx.run(sql`DELETE FROM ai_suggestions WHERE item_id IN (SELECT id FROM items WHERE source_id = ${sourceId})`);
    tx.run(sql`DELETE FROM item_links WHERE item_id IN (SELECT id FROM items WHERE source_id = ${sourceId})`);
    tx.run(sql`DELETE FROM item_errors WHERE item_id IN (SELECT id FROM items WHERE source_id = ${sourceId})`);
    tx.run(sql`DELETE FROM project_items WHERE item_id IN (SELECT id FROM items WHERE source_id = ${sourceId})`);
    // 이 소스의 폴더에 걸린 프로젝트 연결도 지운다 (등록 해제 확인 창에서 안내)
    tx.run(sql`DELETE FROM project_folders WHERE folder_id IN (SELECT id FROM folders WHERE source_id = ${sourceId})`);
    tx.delete(items).where(eq(items.sourceId, sourceId)).run();
    tx.delete(sources).where(eq(sources.id, sourceId)).run();
  });
  enqueue(db, "source_removed", { sourceId });
}

export function enqueue(db: Db, kind: string, payload: Record<string, unknown> = {}) {
  db.insert(commands).values({ kind, payload, createdAt: Date.now() }).run();
}

/** 처음 실행 시 Obsidian 볼트를 기본 소스로 등록한다 (한 번만) */
export function seedDefaultSources(db: Db) {
  const done = db.$client.prepare(`SELECT value FROM settings WHERE key = 'seeded'`).get();
  if (done) return;
  if (fs.existsSync(path.join(PATHS.obsidianVault, ".obsidian")) && !sourceRoots(db).length) {
    try {
      createSource(db, PATHS.obsidianVault);
    } catch {
      // 권한 등 문제가 있으면 설정 화면에서 직접 추가
    }
  }
  db.$client.prepare(`INSERT OR REPLACE INTO settings(key, value) VALUES ('seeded', 'true')`).run();
}

/** Google Drive 폴더를 소스로 등록 (폴더 ID 기준) */
export function createDriveSource(db: Db, folderId: string, folderName: string) {
  const rootPath = `gdrive:/${folderId}`;
  if (sourceRoots(db).includes(rootPath)) throw new Error("이미 등록된 폴더입니다.");
  const row = db
    .insert(sources)
    .values({ kind: "gdrive", name: `${folderName.normalize("NFC")} (Google Drive)`, rootPath, config: { folderId, folderName }, createdAt: Date.now() })
    .returning()
    .get();
  enqueue(db, "source_added", { sourceId: row.id });
  return row;
}
