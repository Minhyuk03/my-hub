"use server";

import { refresh } from "next/cache";
import { getDb } from "@/server/db";
import { acceptProjectSuggestion, acceptTagSuggestion, rejectSuggestion, removeManualTag } from "@/server/ai/pipeline";
import { enqueue } from "@/server/sources/manage";
import { setSetting } from "@/server/settings";

export async function setAiEnabled(on: boolean) {
  const db = getDb();
  setSetting(db, "aiEnabled", on);
  if (on) enqueue(db, "ai_run_now");
  refresh();
}

export async function runAiNow() {
  enqueue(getDb(), "ai_run_now");
  refresh();
}

export async function acceptTags(id: number, selected: string[]) {
  acceptTagSuggestion(getDb(), id, selected);
  refresh();
}

export async function acceptTagsAll(list: { id: number; tags: string[] }[]) {
  const db = getDb();
  for (const x of list) acceptTagSuggestion(db, x.id, x.tags);
  refresh();
}

export async function acceptProject(id: number) {
  acceptProjectSuggestion(getDb(), id);
  refresh();
}

export async function acceptProjectsAll(ids: number[]) {
  const db = getDb();
  for (const id of ids) acceptProjectSuggestion(db, id);
  refresh();
}

export async function rejectAi(ids: number[]) {
  rejectSuggestion(getDb(), ids);
  refresh();
}

export async function removeTag(itemId: number, name: string) {
  removeManualTag(getDb(), itemId, name);
  refresh();
}

export async function saveAiSettings(form: FormData) {
  const db = getDb();
  const th = Number(form.get("threshold"));
  if (th >= 0.3 && th <= 0.95) setSetting(db, "aiProjectThreshold", th);
  const b = Number(form.get("batch"));
  if (b >= 1 && b <= 100) setSetting(db, "aiBatchSize", b);
  const st = String(form.get("structural") ?? "")
    .split(/[,\n]/)
    .map((x) => x.trim().replace(/^#/, ""))
    .filter(Boolean);
  setSetting(db, "aiStructuralTags", st);
  refresh();
}

/** Claude Code 세션 폴더(~/.claude/projects)를 "AI 대화" 소스로 등록. 외부 AI 전송은 기본 금지 */
export async function addClaudeCodeSessions() {
  const { createSource } = await import("@/server/sources/manage");
  const { PATHS } = await import("@/lib/config");
  const { sources } = await import("@/server/db/schema");
  const { eq } = await import("drizzle-orm");
  const db = getDb();
  const { source } = createSource(db, PATHS.claudeProjects, undefined, "Claude Code 세션");
  db.update(sources).set({ kind: "ai", config: { externalAi: "deny", onlyExt: ["jsonl"] } }).where(eq(sources.id, source.id)).run();
  refresh();
}

// ---------- Obsidian PARA 정리 제안 ----------
export async function findParaMoves() {
  const { generateParaMoves } = await import("@/server/projects/para-moves");
  generateParaMoves(getDb());
  refresh();
}

export async function acceptParaMoveAction(id: number) {
  const { acceptParaMove } = await import("@/server/projects/para-moves");
  acceptParaMove(getDb(), id);
  refresh();
}

export async function rejectParaMoveAction(id: number) {
  const { rejectParaMove } = await import("@/server/projects/para-moves");
  rejectParaMove(getDb(), id);
  refresh();
}
