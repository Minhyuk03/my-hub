import fs from "node:fs";
import path from "node:path";
import { isProfileImageName, PROFILE_IMAGE_DIR, PROFILE_IMAGE_TYPES } from "@/server/profile-images";

/** 자기소개에 올린 사진 (profile-images 폴더의 무작위 이름 파일만) */
export async function GET(_: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  if (!isProfileImageName(name)) return new Response(null, { status: 404 });
  const file = path.join(PROFILE_IMAGE_DIR, name);
  if (!fs.existsSync(file)) return new Response(null, { status: 404 });
  return new Response(fs.readFileSync(file), {
    headers: { "Content-Type": PROFILE_IMAGE_TYPES[path.extname(name).slice(1)], "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=31536000, immutable" },
  });
}
