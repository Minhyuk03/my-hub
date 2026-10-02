"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getDb } from "@/server/db";
import type { ProjectKind, ProjectStatus } from "@/server/db/schema";
import {
  clearItemRule,
  createProject,
  deleteProject,
  findFolders,
  linkFolder,
  setFolderSubfolders,
  setItemRule,
  unlinkFolder,
  updateProject,
} from "@/server/projects";
import { importPara, PARA_DIRS } from "@/server/projects/para";
import { acceptSuggestion, rejectSuggestion } from "@/server/projects/suggest";
import { enqueue } from "@/server/sources/manage";

const KINDS = ["project", "area", "resource"] as const;
const kindOf = (v: FormDataEntryValue | null): ProjectKind => (KINDS.includes(String(v) as ProjectKind) ? (String(v) as ProjectKind) : "project");

export async function createProjectAction(form: FormData) {
  const p = createProject(getDb(), String(form.get("name") ?? ""), { kind: kindOf(form.get("kind")) });
  redirect(`/projects/${p.id}`);
}

export async function saveProjectAction(id: number, form: FormData) {
  updateProject(getDb(), id, {
    name: String(form.get("name") ?? ""),
    memo: String(form.get("memo") ?? ""),
    status: String(form.get("status") ?? "active") as ProjectStatus,
    ...(form.get("kind") ? { kind: kindOf(form.get("kind")) } : {}),
  });
  refresh();
}

export async function deleteProjectAction(id: number) {
  deleteProject(getDb(), id);
  redirect("/projects");
}

export async function searchFoldersAction(q: string) {
  return findFolders(getDb(), q);
}

export async function linkFolderAction(projectId: number, folderId: number, includeSubfolders: boolean) {
  linkFolder(getDb(), projectId, folderId, { includeSubfolders });
  refresh();
}

export async function unlinkFolderAction(projectId: number, folderId: number) {
  unlinkFolder(getDb(), projectId, folderId);
  refresh();
}

export async function toggleSubfoldersAction(projectId: number, folderId: number, include: boolean) {
  setFolderSubfolders(getDb(), projectId, folderId, include);
  refresh();
}

export async function itemRuleAction(projectId: number, itemId: number, mode: "include" | "exclude" | "clear") {
  if (mode === "clear") clearItemRule(getDb(), projectId, itemId);
  else setItemRule(getDb(), projectId, itemId, mode);
  refresh();
}

export async function acceptSuggestionAction(id: number, form: FormData) {
  const pid = acceptSuggestion(getDb(), id, String(form.get("name") ?? ""));
  redirect(`/projects/${pid}`);
}

export async function rejectSuggestionAction(id: number) {
  rejectSuggestion(getDb(), id);
  refresh();
}

export async function refreshSuggestionsAction() {
  enqueue(getDb(), "refresh_suggestions");
  refresh();
}

export async function importParaAction(form: FormData) {
  const ids = form.getAll("folder").map(Number).filter(Boolean);
  const kind = kindOf(form.get("kind"));
  importPara(getDb(), ids, PARA_DIRS[kind], kind);
  redirect(`/projects?tab=${kind}`);
}

/** 홈 "쉬고 있는 프로젝트" 버튼 */
export async function staleAction(id: number, what: "on_hold" | "done" | "snooze") {
  const { resolveStale, snoozeStale } = await import("@/server/projects/stale");
  if (what === "snooze") snoozeStale(getDb(), id);
  else resolveStale(getDb(), id, what);
  refresh();
}
