import fs from "node:fs";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { getDb } from "@/server/db";
import { contentDisposition, MIME, resolveItemFile } from "@/server/items/access";
import { enqueue } from "@/server/sources/manage";

/**
 * 원본 파일 보내기: 미리보기(inline) 또는 다운로드(?download=1).
 * Range 요청을 지원해 아이폰에서 PDF·영상이 열리게 한다.
 * iCloud에만 있는 파일은 이 요청 때 iCloud에서 내려받아진다 (사용자가 직접 연 경우에만).
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/items/[id]/file">) {
  const { id } = await ctx.params;
  const r = resolveItemFile(getDb(), Number(id));
  if (!r.ok) return new Response(r.message, { status: r.status });

  const size = fs.statSync(r.path).size;
  // iCloud에만 있던 파일은 이 요청으로 내려받아지므로, 받은 뒤 다시 색인하도록 워커에 알린다
  if (r.item.item.state === "cloud_only") enqueue(getDb(), "reindex", { itemIds: [r.item.item.id] });
  const ext = r.item.item.ext;
  const download = req.nextUrl.searchParams.get("download") === "1";
  const headers: Record<string, string> = {
    "Content-Type": download ? "application/octet-stream" : (MIME[ext] ?? "application/octet-stream"),
    "Content-Disposition": contentDisposition(download ? "attachment" : "inline", r.path),
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  };
  // SVG 안의 스크립트가 허브 권한으로 실행되지 않게 한다 (HTML 등은 MIME 이 없어 다운로드로만 전달됨)
  if (ext === "svg") headers["Content-Security-Policy"] = "sandbox; default-src 'none'; style-src 'unsafe-inline'";

  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && size > 0) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const stream = Readable.toWeb(fs.createReadStream(r.path, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }
  const stream = Readable.toWeb(fs.createReadStream(r.path)) as ReadableStream;
  return new Response(stream, { headers: { ...headers, "Content-Length": String(size) } });
}
