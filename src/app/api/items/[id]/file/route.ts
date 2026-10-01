import fs from "node:fs";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { getDb } from "@/server/db";
import { contentDisposition, MIME, resolveItemFile } from "@/server/items/access";
import { enqueue } from "@/server/sources/manage";
import { getItem } from "@/server/queries";
import { EXPORTS } from "@/server/connectors/gdrive/client";
import { webDrive } from "@/server/connectors/gdrive/web";
import { isDataless, materialize } from "@/lib/fs/dataless";

/**
 * 원본 파일 보내기: 미리보기(inline) 또는 다운로드(?download=1).
 * Range 요청을 지원해 아이폰에서 PDF·영상이 열리게 한다.
 * iCloud에만 있는 파일은 이 요청 때 iCloud에서 내려받아진다 (사용자가 직접 연 경우에만).
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/items/[id]/file">) {
  const { id } = await ctx.params;
  const drive = await driveFile(Number(id), req.nextUrl.searchParams.get("download") === "1");
  if (drive) return drive;
  const r = resolveItemFile(getDb(), Number(id));
  if (!r.ok) return new Response(r.message, { status: r.status });

  // iCloud에만 있는 파일: 백그라운드 서버는 읽기만으로 내려받을 수 없어서 먼저 iCloud에 내려받기를 요청하고 기다린다
  if (isDataless(r.path, fs.statSync(r.path))) {
    const ok = await materialize(r.path, 20_000);
    // 아직이면 흰 화면 대신 "받아오는 중" 화면을 보여주고 3초마다 다시 시도한다 (내려받기는 계속 진행됨)
    if (!ok) return waitingPage(r.item.item.title);
  }
  // 받은 뒤 다시 색인하도록 워커에 알린다
  if (r.item.item.state === "cloud_only") enqueue(getDb(), "reindex", { itemIds: [r.item.item.id] });
  const size = fs.statSync(r.path).size;
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

function waitingPage(title: string) {
  const esc = title.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return new Response(
    `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="3">
<title>iCloud에서 받아오는 중</title><style>body{font-family:-apple-system,"Apple SD Gothic Neo",sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;text-align:center;padding:16px}
@media(prefers-color-scheme:dark){body{background:#0a0a0a;color:#ededed}}p{color:#888}</style></head>
<body><div><h1 style="font-size:18px">iCloud에서 받아오는 중…</h1><p>${esc}</p><p>받아오면 자동으로 열립니다. 파일이 크거나 iCloud가 느리면 몇 분 걸릴 수 있습니다.</p></div></body></html>`,
    { status: 202, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

/** Google Drive 항목: Drive 에서 받아 그대로 흘려보낸다. Google 문서류는 PDF 로 변환 */
async function driveFile(id: number, download: boolean): Promise<Response | null> {
  const it = getItem(getDb(), id);
  if (!it || it.source.kind !== "gdrive") return null;
  if (it.item.state === "deleted") return new Response("삭제된 항목입니다.", { status: 410 });
  if (!it.item.externalId) return new Response("원본 ID가 없습니다.", { status: 404 });
  try {
    const d = webDrive();
    const meta = await d.getFile(it.item.externalId);
    const r = await d.download(meta);
    const exported = !!EXPORTS[meta.mimeType];
    const name = exported ? `${meta.name}.pdf` : meta.name;
    const type = exported ? "application/pdf" : (MIME[it.item.ext] ?? r.headers.get("content-type") ?? "application/octet-stream");
    const headers: Record<string, string> = {
      "Content-Type": download ? "application/octet-stream" : type,
      "Content-Disposition": contentDisposition(download ? "attachment" : "inline", name),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    };
    if (it.item.ext === "svg") headers["Content-Security-Policy"] = "sandbox; default-src 'none'; style-src 'unsafe-inline'";
    const len = r.headers.get("content-length");
    if (len) headers["Content-Length"] = len;
    return new Response(r.body, { headers });
  } catch (e) {
    return new Response(`Google Drive에서 받지 못했습니다: ${(e as Error).message}`, { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}
