/**
 * 자기소개 화면에 올린 사진 (프로필·배경·프로젝트 표지). 앱 데이터 폴더의 profile-images/ 에 무작위 이름으로 저장하고,
 * 자기소개에는 "upload:<이름>" 으로 적는다 (src/server/profile.ts 의 imageSrc 가 /api/profile-images/<이름> 으로 바꿈).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/config";
import { splitImageRef, type Profile } from "./profile";

export const PROFILE_IMAGE_DIR = path.join(DATA_DIR, "profile-images");
export const PROFILE_IMAGE_TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
export const MAX_PROFILE_IMAGE = 15 * 1024 * 1024;
const NAME = /^[a-f0-9]{16}\.(jpg|jpeg|png|webp|gif)$/;

export const isProfileImageName = (name: string) => NAME.test(name);

/** 파일 저장 → "upload:<이름>". 형식·크기가 맞지 않으면 이유와 함께 실패 */
export function saveProfileImage(fileName: string, mime: string, data: Buffer, dir = PROFILE_IMAGE_DIR): { ok: true; ref: string } | { ok: false; message: string } {
  const ext = path.extname(fileName).slice(1).toLowerCase();
  if (!PROFILE_IMAGE_TYPES[ext] || !mime.startsWith("image/")) return { ok: false, message: "jpg, png, webp, gif 이미지만 올릴 수 있습니다." };
  if (!data.length) return { ok: false, message: "빈 파일입니다." };
  if (data.length > MAX_PROFILE_IMAGE) return { ok: false, message: "15MB 이하 이미지만 올릴 수 있습니다." };
  const name = `${crypto.randomBytes(8).toString("hex")}.${ext}`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), data);
  return { ok: true, ref: `upload:${name}` };
}

/** 자기소개에서 쓰는 업로드 이름들 */
export function referencedUploads(p: Profile): Set<string> {
  const refs = [p.photo, p.hero, ...p.projects.map((x) => x.cover)];
  return new Set(refs.map((r) => splitImageRef(r).ref.match(/^upload:(.+)$/)?.[1]).filter((x): x is string => !!x));
}

/** 더 쓰지 않는 업로드 지우기. 방금 올리고 아직 저장 전인 파일을 지우지 않게 한 시간 넘은 것만 */
export function removeUnusedUploads(p: Profile, now = Date.now(), dir = PROFILE_IMAGE_DIR): number {
  if (!fs.existsSync(dir)) return 0;
  const used = referencedUploads(p);
  let n = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!NAME.test(name) || used.has(name)) continue;
    const file = path.join(dir, name);
    if (now - fs.statSync(file).mtimeMs < 3600_000) continue;
    fs.rmSync(file, { force: true });
    n++;
  }
  return n;
}
