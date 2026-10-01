import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/config";
import { getDb } from "@/server/db";
import { isLocalRequest } from "@/server/http/local";
import { enqueue } from "@/server/sources/manage";

/** claude.ai·ChatGPT 내보내기 파일 올리기 → 워커가 읽어 대화를 가져온다 (Mac mini 본인 접속에서만) */
export async function POST(req: Request) {
  if (!isLocalRequest(req.headers)) return Response.json({ ok: false, message: "Mac mini에서 직접 접속한 경우에만 올릴 수 있습니다." }, { status: 403 });
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return Response.json({ ok: false, message: "파일을 선택하세요." }, { status: 400 });
  if (!/\.(zip|json)$/i.test(file.name)) return Response.json({ ok: false, message: "zip 또는 json 파일만 올릴 수 있습니다." }, { status: 400 });
  const dir = path.join(DATA_DIR, "imports");
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${Date.now()}${path.extname(file.name).toLowerCase()}`);
  fs.writeFileSync(dest, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
  enqueue(getDb(), "import_chats", { file: dest, name: file.name });
  return Response.json({ ok: true, message: "받았습니다. 대화를 가져오는 중입니다 (크기에 따라 몇 분)." });
}
