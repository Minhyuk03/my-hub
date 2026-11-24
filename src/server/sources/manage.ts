import fs from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { PATHS } from "@/lib/config";
import type { Db } from "../db";
import { commands, folders, items, scanJobs, sources } from "../db/schema";
import { writeItemText } from "../search/index-writer";
import { excludedPaths, getSettings, setSetting } from "../settings";
import { checkAvailability, realMountEnv, type MountEnv } from "./availability";
import { checkNewSource, isInside, type SourceCheck } from "./rules";

export function sourceRoots(db: Db) {
  return db.select({ rootPath: sources.rootPath }).from(sources).all().map((r) => r.rootPath);
}

export function previewNewSource(db: Db, p: string): SourceCheck {
  return checkNewSource(p, { existingRoots: sourceRoots(db), excludedFolders: excludedPaths(getSettings(db)) });
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

/**
 * 소스 위치 바꾸기: 폴더를 다른 곳으로 옮겼을 때 쓴다. 실제 파일은 건드리지 않는다.
 * 항목·폴더 ID 를 그대로 두고 경로만 새 위치로 바꾸므로 프로젝트 연결·태그·AI 제안·채팅 인용이 유지된다.
 * 다음 스캔에서 같은 경로의 파일은 그대로 이어지고, 다른 하위 폴더로 옮긴 파일은 inode 로 찾아 이어지며, 없는 파일만 삭제로 표시된다.
 * 원래 위치에 폴더가 아직 있으면(복사본일 수 있음) 바꾸지 않는다.
 */
export function relocateSource(db: Db, sourceId: number, newPath: string, mount: MountEnv = realMountEnv): { name: string; root: string; moved: number } {
  const src = db.select().from(sources).where(eq(sources.id, sourceId)).get();
  if (!src) throw new Error("소스를 찾을 수 없습니다.");
  if (!src.rootPath.startsWith("/")) throw new Error("연결 서비스 소스는 위치를 바꿀 수 없습니다.");
  if (src.status === "syncing") throw new Error("스캔 중에는 바꿀 수 없습니다. 잠시 뒤 다시 시도하세요.");
  if (checkAvailability(src, mount).ok) throw new Error("원래 위치에 폴더가 아직 있습니다. 옮긴 폴더만 고를 수 있습니다.");
  const others = sourceRoots(db).filter((r) => r !== src.rootPath);
  const check = checkNewSource(newPath, { existingRoots: others, excludedFolders: excludedPaths(getSettings(db)) });
  if (!check.ok) throw new Error(check.error);
  // 경로는 파일시스템이 준 바이트 그대로 저장돼 있다 (한글이 NFD 인 경우가 많음). 앞부분(소스 위치)만 바꾸고 나머지는 건드리지 않는다.
  // NFC 로 바꿔 저장하면 스캐너가 같은 파일을 못 알아보고 새 항목을 만든다.
  const to = check.realPath!;
  const from = src.rootPath;
  if (others.some((r) => isInside(to, r) || isInside(r, to))) throw new Error("다른 인덱싱 폴더와 겹치는 위치입니다.");
  const swap = (p: string) => (p === from ? to : p.startsWith(from + "/") ? to + p.slice(from.length) : null);
  // 설정(제외 폴더·민감 정보)은 NFC 로 저장돼 있으므로 NFC 끼리 비교한다
  const fromN = from.normalize("NFC");
  const toN = to.normalize("NFC");
  const swapN = (p: string) => {
    const n = p.normalize("NFC");
    return n === fromN ? toN : n.startsWith(fromN + "/") ? toN + n.slice(fromN.length) : null;
  };
  const under = sql`(path = ${src.rootPath} OR (path > ${src.rootPath + "/"} AND path < ${src.rootPath + "0"}))`;
  const c = db.$client;
  let moved = 0;
  db.transaction((tx) => {
    for (const it of tx.select({ id: items.id, path: items.path }).from(items).where(sql`source_id = ${sourceId} AND ${under}`).all()) {
      const np = swap(it.path);
      if (!np) continue;
      tx.update(items).set({ path: np }).where(eq(items.id, it.id)).run();
      // 검색 색인에도 경로가 들어 있다 (경로로 찾기)
      const t = c.prepare(`SELECT title, body FROM item_text WHERE item_id = ?`).get(it.id) as { title: string; body: string } | undefined;
      if (t) writeItemText(db, it.id, { title: t.title, path: np, body: t.body });
      tx.run(sql`UPDATE chat_citations SET path = ${np} WHERE item_id = ${it.id}`);
      moved++;
    }
    for (const f of tx.select({ id: folders.id, path: folders.path }).from(folders).where(sql`source_id = ${sourceId} AND ${under}`).all()) {
      const np = swap(f.path);
      if (np) tx.update(folders).set({ path: np, ...(np === to ? { name: path.basename(to).normalize("NFC") } : {}) }).where(eq(folders.id, f.id)).run();
    }
    // 아직 결정하지 않은 정리 제안의 경로도 옮긴다
    for (const m of c.prepare(`SELECT id, from_path AS f, to_path AS t FROM para_moves WHERE status = 'pending'`).all() as { id: number; f: string; t: string }[]) {
      const nf = swap(m.f) ?? swapN(m.f);
      const nt = swap(m.t) ?? swapN(m.t);
      if (nf || nt) c.prepare(`UPDATE para_moves SET from_path = ?, to_path = ? WHERE id = ?`).run(nf ?? m.f, nt ?? m.t, m.id);
    }
    // 이어서 할 스캔 기록은 옛 경로 기준이라 버린다
    tx.delete(scanJobs).where(sql`source_id = ${sourceId} AND result IN ('running', 'aborted')`).run();
    const autoName = src.name === defaultName(src.rootPath, src.kind);
    const name = autoName ? defaultName(to, check.kind!) : src.name;
    const volumeRoot = check.volumeRoot ?? null;
    tx.update(sources)
      .set({
        rootPath: to,
        kind: check.kind!,
        name,
        volumeRoot,
        volumeUuid: volumeRoot ? (mount.volumeUuid(volumeRoot) ?? null) : null,
        status: "ok",
        lastError: null,
        lastFullScanAt: null,
      })
      .where(eq(sources.id, sourceId))
      .run();
  });
  // 제외 폴더·민감 정보로 숨긴 곳도 새 위치를 따라간다
  const s = getSettings(db);
  for (const key of ["excludedFolders", "sensitivePaths"] as const) {
    const next = s[key].map((p) => swapN(p) ?? p);
    if (next.some((p, i) => p !== s[key][i])) setSetting(db, key, next);
  }
  enqueue(db, "source_moved", { sourceId });
  const after = db.select({ name: sources.name }).from(sources).where(eq(sources.id, sourceId)).get()!;
  return { name: after.name, root: toN, moved };
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

export function enqueue(db: Db, kind: string, payload: Record<string, unknown> = {}): number {
  return db.insert(commands).values({ kind, payload, createdAt: Date.now() }).returning({ id: commands.id }).get().id;
}

export type CommandOutcome = { done: boolean; result: string | null };

/** 명령을 넣고 워커가 끝낼 때까지 잠시 기다린다. 시간 안에 안 끝나면 done=false (워커가 멈췄거나 오래 걸림) */
export async function enqueueAndWait(db: Db, kind: string, payload: Record<string, unknown> = {}, timeoutMs = 20_000): Promise<CommandOutcome> {
  const id = enqueue(db, kind, payload);
  const until = Date.now() + timeoutMs;
  for (;;) {
    const row = db.select({ doneAt: commands.doneAt, result: commands.result }).from(commands).where(eq(commands.id, id)).get();
    if (row?.doneAt) return { done: true, result: row.result };
    if (Date.now() >= until) return { done: false, result: null };
    await new Promise((r) => setTimeout(r, 300));
  }
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
