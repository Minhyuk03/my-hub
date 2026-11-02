import type { NextRequest } from "next/server";
import { markForeground } from "@/server/ai/foreground";
import { Ollama, realOllama } from "@/server/ai/ollama";
import { getDb } from "@/server/db";
import { parseFilters } from "@/server/search/params";
import { browse } from "@/server/search/query";
import { hybridSearch } from "@/server/search/semantic";
import { getSettings } from "@/server/settings";

/** ⌘K 검색: 검색 화면과 같은 방식(기본 섞어서)으로 찾아 결과·건수가 같게 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q") ?? "";
  const limit = Math.min(50, Number(sp.get("limit") ?? 20));
  const mode = (["keyword", "semantic", "hybrid"].includes(sp.get("mode") ?? "") ? sp.get("mode") : "hybrid") as "hybrid" | "keyword" | "semantic";
  const db = getDb();
  // ⌘K 를 막 열었을 때: 검색어 없이 최근 수정한 항목
  if (!q.trim() && sp.get("recent")) return Response.json(browse(db, parseFilters(sp), limit));
  const hasVectors = (db.$client.prepare(`SELECT count(*) FROM item_chunk_state`).pluck().get() as number) > 0;
  const ai = hasVectors && mode !== "keyword" ? new Ollama(realOllama()) : null;
  if (ai && q.trim()) markForeground(db, 2 * 60_000);
  const r = await hybridSearch(db, ai, getSettings(db).aiEmbedModel, q, parseFilters(sp), limit, 0, hasVectors ? mode : "keyword");
  return Response.json(r);
}
