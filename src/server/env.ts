import fs from "node:fs";
import path from "node:path";

/** 워커·스크립트에서 .env.local 을 읽는다 (Next.js 웹 서버는 스스로 읽음). 값은 출력하지 않는다. */
export function loadEnvLocal(root = process.env.HUB_ROOT ?? process.cwd()) {
  const f = path.join(root, ".env.local");
  if (fs.existsSync(f)) process.loadEnvFile(f);
}
