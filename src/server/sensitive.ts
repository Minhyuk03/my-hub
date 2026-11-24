/**
 * 민감 정보로 숨기기: 폴더·파일을 허브에서 통째로 감춘다.
 * - 숨긴 경로는 색인하지 않는다 (제외 폴더와 같은 방식). 목록·검색·그래프·홈·AI 어디에도 나오지 않는다.
 * - 이미 색인된 것은 바로 지우고, 채팅 인용·그 인용을 쓴 AI 답변·프로젝트 연결·즐겨찾기까지 지운다 (purgeExcluded).
 * - 실제 파일은 건드리지 않는다. 다시 보이게 하면 다음 스캔에서 새로 색인한다.
 */
import { eq } from "drizzle-orm";
import type { Db } from "./db";
import { folders, items, sources } from "./db/schema";
import { getSettings, setSetting } from "./settings";
import { enqueue } from "./sources/manage";
import { isExcludedFolder } from "./sources/rules";
import { purgeExcluded } from "./sync/scanner";

export type HideTarget = { kind: "folder" | "item"; id: number };
export type HideResult = { ok: true; path: string; removed: number; parentFolderId: number | null } | { ok: false; message: string };

/** 숨길 대상의 경로와, 숨긴 뒤 돌아갈 상위 폴더 */
function locate(db: Db, t: HideTarget): { path: string; sourceId: number; root: string; parentPath: string } | null {
  const row =
    t.kind === "folder"
      ? db.select({ path: folders.path, sourceId: folders.sourceId }).from(folders).where(eq(folders.id, t.id)).get()
      : db.select({ path: items.path, sourceId: items.sourceId }).from(items).where(eq(items.id, t.id)).get();
  if (!row) return null;
  const src = db.select({ root: sources.rootPath }).from(sources).where(eq(sources.id, row.sourceId)).get();
  if (!src) return null;
  const p = row.path.normalize("NFC");
  return { path: p, sourceId: row.sourceId, root: src.root.normalize("NFC"), parentPath: p.slice(0, p.lastIndexOf("/")) };
}

export function hideSensitive(db: Db, t: HideTarget): HideResult {
  const at = locate(db, t);
  if (!at) return { ok: false, message: "대상을 찾을 수 없습니다." };
  if (at.path === at.root) return { ok: false, message: "소스 맨 위 폴더는 숨길 수 없습니다. 설정에서 소스 등록을 해제하세요." };
  const s = getSettings(db);
  if (!isExcludedFolder(at.path, s.sensitivePaths)) setSetting(db, "sensitivePaths", [...s.sensitivePaths, at.path]);
  const removed = purgeExcluded(db);
  // 워커가 감시 대상을 다시 읽고 남은 것도 정리하게 한다
  enqueue(db, "settings_changed");
  const parent = db.select({ id: folders.id }).from(folders).where(eq(folders.path, at.parentPath)).get();
  return { ok: true, path: at.path, removed, parentFolderId: parent?.id ?? null };
}

/** 다시 보이게 하기: 목록에서 빼고 그 소스를 다시 검사해 새로 색인한다 */
export function unhideSensitive(db: Db, p: string): boolean {
  const s = getSettings(db);
  const n = p.normalize("NFC");
  if (!s.sensitivePaths.includes(n)) return false;
  setSetting(db, "sensitivePaths", s.sensitivePaths.filter((x) => x !== n));
  enqueue(db, "settings_changed");
  for (const src of db.select({ id: sources.id, root: sources.rootPath }).from(sources).all())
    if (n.startsWith(src.root.normalize("NFC") + "/")) enqueue(db, "rescan", { sourceId: src.id });
  return true;
}
