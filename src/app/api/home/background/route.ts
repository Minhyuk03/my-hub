import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/config";
import { getDb } from "@/server/db";
import { getSettings } from "@/server/settings";

const TYPES: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

/** 홈 배경 이미지 (앱 데이터 폴더의 파일만) */
export async function GET() {
  const name = getSettings(getDb()).homeBackground;
  const ext = path.extname(name).slice(1).toLowerCase();
  if (!name || !/^home-bg-\d+\.[a-z]+$/.test(name) || !TYPES[ext]) return new Response(null, { status: 404 });
  const file = path.join(DATA_DIR, name);
  if (!fs.existsSync(file)) return new Response(null, { status: 404 });
  return new Response(fs.readFileSync(file), { headers: { "Content-Type": TYPES[ext], "Cache-Control": "private, max-age=86400" } });
}
