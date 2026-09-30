import type { NextRequest } from "next/server";
import { getDb } from "@/server/db";
import { buildGraph } from "@/server/graph";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const colorBy = sp.get("color");
  const g = buildGraph(getDb(), {
    projectId: Number(sp.get("project")) || undefined,
    sourceIds: sp.getAll("source").map(Number).filter(Boolean),
    includeTags: sp.get("tags") === "1",
    includeAttachments: sp.get("files") === "1",
    includeOrphans: sp.get("orphans") === "1",
    colorBy: colorBy === "tag" || colorBy === "source" ? colorBy : "folder",
  });
  return Response.json(g);
}
