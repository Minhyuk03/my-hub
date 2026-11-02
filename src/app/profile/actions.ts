"use server";

import { refresh } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { projects } from "@/server/db/schema";
import { normalizeProfile, type Profile } from "@/server/profile";
import { getSettings, setSetting } from "@/server/settings";

export async function saveProfile(p: Profile): Promise<{ ok: boolean; message: string }> {
  setSetting(getDb(), "profile", normalizeProfile(p));
  refresh();
  return { ok: true, message: "저장했습니다." };
}

/** 첫 화면의 "허브 프로젝트에서 고르기": 이름만 채운 포트폴리오 항목을 추가 (설명은 편집에서) */
export async function addHubProject(projectId: number) {
  const db = getDb();
  const pr = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!pr) return;
  const p = normalizeProfile(getSettings(db).profile);
  if (p.projects.some((x) => x.projectId === projectId)) return;
  p.projects.push({ title: pr.name, period: "", role: "", summary: "", tech: "", projectId, url: "", public: false });
  setSetting(db, "profile", p);
  refresh();
}
