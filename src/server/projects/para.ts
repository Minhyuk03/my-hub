import path from "node:path";
import { and, eq } from "drizzle-orm";
import { PATHS } from "@/lib/config";
import type { Db } from "../db";
import { folders, projects, type ProjectKind } from "../db/schema";
import { createProject, linkFolder } from "./index";

export const PARA_PROJECTS_DIR = path.join(PATHS.obsidianVault, "1. Projects");
/** 종류별로 가져올 Obsidian PARA 폴더 */
export const PARA_DIRS: Record<ProjectKind, string> = {
  project: PARA_PROJECTS_DIR,
  area: path.join(PATHS.obsidianVault, "2. Areas"),
  resource: path.join(PATHS.obsidianVault, "3. Resources"),
};

/** Obsidian "1. Projects" 바로 아래 폴더 목록 (가져오기 전 미리보기) */
export function previewParaImport(db: Db, projectsDir = PARA_PROJECTS_DIR) {
  const names = new Map(db.select().from(projects).all().map((p) => [p.name.normalize("NFC"), p.id]));
  return db
    .select()
    .from(folders)
    .where(eq(folders.state, "ok"))
    .all()
    .filter((f) => path.dirname(f.path).normalize("NFC") === projectsDir.normalize("NFC"))
    .map((f) => ({ folderId: f.id, name: f.name, path: f.path, existingProjectId: names.get(f.name.normalize("NFC")) ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/** 선택한 폴더를 프로젝트로 만든다. 같은 이름의 프로젝트가 있으면 거기에 폴더만 연결한다. */
export function importPara(db: Db, folderIds: number[], projectsDir = PARA_PROJECTS_DIR, kind: ProjectKind = "project") {
  const preview = previewParaImport(db, projectsDir);
  let created = 0;
  let linked = 0;
  for (const p of preview.filter((x) => folderIds.includes(x.folderId))) {
    let pid = p.existingProjectId;
    if (!pid) {
      pid = createProject(db, p.name, { kind }).id;
      created++;
    }
    const f = db.select().from(folders).where(and(eq(folders.id, p.folderId))).get();
    if (f) {
      linkFolder(db, pid, f.id, { addedBy: "import" });
      linked++;
    }
  }
  return { created, linked };
}
