"use server";

import { refresh } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { projects } from "@/server/db/schema";
import { normalizeProfile, type Profile } from "@/server/profile";
import { removeUnusedUploads, saveProfileImage } from "@/server/profile-images";
import { getSettings, setSetting } from "@/server/settings";

export async function saveProfile(p: Profile): Promise<{ ok: boolean; message: string }> {
  const clean = normalizeProfile(p);
  setSetting(getDb(), "profile", clean);
  removeUnusedUploads(clean);
  refresh();
  return { ok: true, message: "저장했습니다." };
}

/** 사진 올리기 (편집 화면의 사진 칸). 저장하기 전까지는 자기소개에 적히지 않는다 */
export async function uploadProfileImage(form: FormData): Promise<{ ok: true; ref: string } | { ok: false; message: string }> {
  const file = form.get("image");
  if (!(file instanceof File) || !file.size) return { ok: false, message: "이미지를 고르세요." };
  return saveProfileImage(file.name, file.type, Buffer.from(await file.arrayBuffer()));
}

/** 첫 화면의 "허브 프로젝트에서 고르기": 이름만 채운 포트폴리오 항목을 추가 (설명은 편집에서) */
export async function addHubProject(projectId: number) {
  const db = getDb();
  const pr = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!pr) return;
  const p = normalizeProfile(getSettings(db).profile);
  if (p.projects.some((x) => x.projectId === projectId)) return;
  p.projects.push({ title: pr.name, period: "", contribution: "", role: "", result: "", tech: "", summary: "", cover: "", url: "", projectId, public: false });
  setSetting(db, "profile", p);
  refresh();
}
