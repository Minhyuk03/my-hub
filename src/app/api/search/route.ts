import type { NextRequest } from "next/server";
import { getDb } from "@/server/db";
import { search } from "@/server/search/query";
import { parseFilters } from "@/server/search/params";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q") ?? "";
  const limit = Math.min(50, Number(sp.get("limit") ?? 20));
  const r = search(getDb(), q, parseFilters(sp), limit);
  return Response.json(r);
}
