import fs from "node:fs";
import path from "node:path";
import type { Db } from "../db";
import { getItem } from "../queries";
import { isInside } from "../sources/rules";

export const MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  md: "text/plain; charset=utf-8",
  txt: "text/plain; charset=utf-8",
};

/**
 * 파일을 열어도 되는 항목인지 확인하고 실제 경로를 돌려준다.
 * 임의 경로 요청은 받지 않고, DB에 등록된 항목 ID로만 접근한다.
 */
export function resolveItemFile(db: Db, id: number): { ok: true; path: string; item: NonNullable<ReturnType<typeof getItem>> } | { ok: false; status: number; message: string } {
  const it = getItem(db, id);
  if (!it) return { ok: false, status: 404, message: "항목을 찾을 수 없습니다." };
  if (it.item.state === "deleted") return { ok: false, status: 410, message: "삭제된 항목입니다." };
  if (it.source.status === "offline") return { ok: false, status: 503, message: "소스가 오프라인입니다." };
  let real: string;
  try {
    real = fs.realpathSync(it.item.path);
  } catch {
    return { ok: false, status: 404, message: "파일이 없습니다." };
  }
  // 심볼릭 링크 등으로 소스 밖을 가리키면 거부
  if (!isInside(real, it.source.rootPath)) return { ok: false, status: 403, message: "소스 폴더 밖의 파일입니다." };
  if (!fs.statSync(real).isFile()) return { ok: false, status: 400, message: "파일이 아닙니다." };
  return { ok: true, path: real, item: it };
}

export function contentDisposition(kind: "inline" | "attachment", filename: string) {
  const name = path.basename(filename).normalize("NFC");
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
