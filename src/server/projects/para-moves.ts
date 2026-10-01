/**
 * Obsidian PARA 정리 제안 (이동은 사용자가 수락한 경우만)
 * - archive: "완료"로 바꾼 프로젝트에 연결된 "1. Projects"·"2. Areas" 아래 폴더 → "4. Archives/폴더이름"
 * - note: PARA 폴더(1~4) 밖에 있는 노트 → 내용이 가장 비슷한 노트들이 모여 있는 PARA 하위 폴더 (이웃 7개 중 3개 이상)
 * 옮길 곳의 상위 폴더가 이미 있을 때만 제안하고(새 폴더를 만들지 않는다), 같은 이름이 있으면 옮기지 않는다.
 * 거절한 제안은 다시 만들지 않는다.
 */
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import type { Db } from "../db";
import { paraMoves, sources } from "../db/schema";
import { dot, fromBuf } from "../ai/pipeline";
import { getSettings } from "../settings";
import { enqueue } from "../sources/manage";

const PARA_TOP = /^[1-4]\.\s/;
const SKIP_TOP = /^(\.|_)|template|attach|asset|첨부|템플릿|excalidraw/i;
const ARCHIVE = "4. Archives";
const K = 7;
const MIN_SIM = 0.55;
const MIN_VOTES = 3;

export type MoveFs = { exists: (p: string) => boolean; isDir: (p: string) => boolean; rename: (a: string, b: string) => void };
export const realMoveFs: MoveFs = {
  exists: (p) => fs.existsSync(p),
  isDir: (p) => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  },
  rename: (a, b) => fs.renameSync(a, b),
};

const nfc = (s: string) => s.normalize("NFC");

function vaultRoot(db: Db): { id: number; root: string } | null {
  const s = db.select().from(sources).where(eq(sources.kind, "obsidian")).get();
  return s ? { id: s.id, root: s.rootPath } : null;
}

function insert(db: Db, row: Omit<typeof paraMoves.$inferInsert, "status" | "createdAt">, now: number): boolean {
  const r = db
    .insert(paraMoves)
    .values({ ...row, status: "pending", createdAt: now })
    .onConflictDoNothing()
    .run();
  return r.changes > 0;
}

/** 새 제안 만들기. 만든 개수 */
export function generateParaMoves(db: Db, fsx: MoveFs = realMoveFs, now = Date.now()): number {
  const v = vaultRoot(db);
  if (!v) return 0;
  const c = db.$client;
  let n = 0;

  // 1) 완료된 프로젝트 폴더 → 4. Archives
  const archiveDir = path.join(v.root, ARCHIVE);
  if (fsx.isDir(archiveDir)) {
    const rows = c
      .prepare(
        `SELECT p.name, f.id AS folderId, f.path FROM projects p JOIN project_folders pf ON pf.project_id = p.id JOIN folders f ON f.id = pf.folder_id
         WHERE p.status = 'done' AND f.state = 'ok' AND f.source_id = ?`,
      )
      .all(v.id) as { name: string; folderId: number; path: string }[];
    for (const r of rows) {
      const rel = r.path.slice(v.root.length + 1);
      if (!/^(1\. Projects|2\. Areas)\//.test(nfc(rel))) continue;
      const to = path.join(archiveDir, path.basename(r.path));
      if (fsx.exists(to)) continue;
      if (insert(db, { kind: "archive", folderId: r.folderId, fromPath: r.path, toPath: to, reason: `프로젝트 "${r.name}" 가 완료 상태입니다.` }, now)) n++;
    }
  }

  // 2) PARA 밖의 노트 → 비슷한 노트들이 있는 PARA 폴더
  const model = getSettings(db).aiEmbedModel;
  const notes = c
    .prepare(
      `SELECT i.id, i.path, e.vector FROM items i JOIN item_embeddings e ON e.item_id = i.id
       WHERE i.source_id = ? AND i.state != 'deleted' AND i.ext = 'md' AND e.model = ?`,
    )
    .all(v.id, model) as { id: number; path: string; vector: Buffer }[];
  const inPara: { dir: string; vec: Float32Array }[] = [];
  const loose: { id: number; path: string; vec: Float32Array }[] = [];
  for (const r of notes) {
    const rel = nfc(r.path.slice(v.root.length + 1));
    const top = rel.split("/")[0];
    if (PARA_TOP.test(top) && rel.includes("/")) {
      const parts = rel.split("/");
      // 두 단계 폴더까지 (예: "3. Resources/개발"), 바로 아래 노트면 PARA 폴더 자체
      const dir = parts.length > 2 ? parts.slice(0, 2).join("/") : parts[0];
      inPara.push({ dir, vec: fromBuf(r.vector) });
    } else if (!rel.includes("/") || !SKIP_TOP.test(top)) {
      loose.push({ id: r.id, path: r.path, vec: fromBuf(r.vector) });
    }
  }
  if (inPara.length >= K) {
    for (const l of loose) {
      const near = inPara
        .map((p) => ({ dir: p.dir, sim: dot(l.vec, p.vec) }))
        .sort((a, b) => b.sim - a.sim)
        .slice(0, K)
        .filter((x) => x.sim >= MIN_SIM);
      const votes = new Map<string, number>();
      for (const x of near) votes.set(x.dir, (votes.get(x.dir) ?? 0) + 1);
      const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
      if (!best || best[1] < MIN_VOTES) continue;
      const toDir = path.join(v.root, best[0]);
      if (!fsx.isDir(toDir)) continue;
      const to = path.join(toDir, path.basename(l.path));
      if (fsx.exists(to)) continue;
      if (insert(db, { kind: "note", itemId: l.id, fromPath: l.path, toPath: to, reason: `비슷한 노트 ${best[1]}개가 "${best[0]}" 에 있습니다.` }, now)) n++;
    }
  }
  return n;
}

export function pendingParaMoves(db: Db) {
  const v = vaultRoot(db);
  return db
    .select()
    .from(paraMoves)
    .where(eq(paraMoves.status, "pending"))
    .all()
    .map((m) => ({ ...m, fromLabel: v ? nfc(m.fromPath.slice(v.root.length + 1)) : nfc(m.fromPath), toLabel: v ? nfc(m.toPath.slice(v.root.length + 1)) : nfc(m.toPath) }));
}

/** 수락: 실제로 옮긴다. 옮기기 직전에 다시 확인 (원본 있음, 대상 없음, 대상 상위 폴더 있음, 둘 다 볼트 안) */
export function acceptParaMove(db: Db, id: number, fsx: MoveFs = realMoveFs, now = Date.now()): { ok: boolean; message: string } {
  const m = db.select().from(paraMoves).where(and(eq(paraMoves.id, id), eq(paraMoves.status, "pending"))).get();
  if (!m) return { ok: false, message: "제안을 찾을 수 없습니다." };
  const v = vaultRoot(db);
  const fail = (message: string) => {
    db.update(paraMoves).set({ status: "failed", message, decidedAt: now }).where(eq(paraMoves.id, id)).run();
    return { ok: false, message };
  };
  if (!v || !m.fromPath.startsWith(v.root + "/") || !m.toPath.startsWith(v.root + "/") || m.toPath.includes("/../")) return fail("볼트 밖으로는 옮기지 않습니다.");
  if (!fsx.exists(m.fromPath)) return fail("원래 파일이 없습니다 (이미 옮겼거나 지워짐).");
  if (fsx.exists(m.toPath)) return fail("옮길 곳에 같은 이름이 이미 있습니다.");
  if (!fsx.isDir(path.dirname(m.toPath))) return fail("옮길 폴더가 없습니다 (새 폴더는 만들지 않습니다).");
  try {
    fsx.rename(m.fromPath, m.toPath);
  } catch (e) {
    return fail(`옮기지 못했습니다: ${(e as Error).message}`);
  }
  db.update(paraMoves).set({ status: "accepted", message: null, decidedAt: now }).where(eq(paraMoves.id, id)).run();
  enqueue(db, "rescan", { sourceId: v.id });
  return { ok: true, message: "옮겼습니다." };
}

export function rejectParaMove(db: Db, id: number, now = Date.now()) {
  db.update(paraMoves).set({ status: "rejected", decidedAt: now }).where(and(eq(paraMoves.id, id), eq(paraMoves.status, "pending"))).run();
}
