import { connection } from "next/server";
import { Button } from "@/components/ui/button";
import { getDb } from "@/server/db";
import { projects } from "@/server/db/schema";
import { tagTree } from "@/server/graph";
import { setDownloadTextAction } from "./actions";
import { GraphClient } from "./graph-client";

export default async function GraphPage() {
  await connection();
  const db = getDb();
  const tags = tagTree(db);
  const projectRows = db.select({ id: projects.id, name: projects.name }).from(projects).all();
  // 본문이 없어 연결을 알 수 없는 노트가 많은 소스 안내
  const noteStats = db.$client
    .prepare(
      `SELECT s.id, s.name, s.kind, s.config, sum(i.state = 'cloud_only') AS cloud, count(*) AS total
       FROM items i JOIN sources s ON s.id = i.source_id WHERE i.kind = 'note' AND i.state != 'deleted' GROUP BY s.id`,
    )
    .all() as { id: number; name: string; kind: string; config: string; cloud: number; total: number }[];
  const hints = noteStats
    .map((s) => ({ ...s, downloadText: !!JSON.parse(s.config || "{}").downloadText }))
    .filter((s) => s.downloadText || (s.kind === "obsidian" && s.cloud > 0));

  return (
    <div className="-my-6 mx-[calc(50%-50vw)] flex h-[calc(100dvh-61px)] flex-col">
      {hints.map((h) => (
        <div key={h.id} className="flex flex-wrap items-center gap-2 border-b border-foreground/10 bg-muted/60 px-4 py-2 text-sm">
          {h.downloadText ? (
            <span>
              {h.name}: 텍스트 파일 내려받기 켜짐{h.cloud > 0 ? ` — 아직 받지 못한 노트 ${h.cloud}개 (백그라운드에서 받는 중)` : ""}
            </span>
          ) : (
            <span>
              {h.name}: 노트 {h.total}개 중 {h.cloud}개가 iCloud에만 있어 링크·태그를 알 수 없습니다. 켜면 2MB 이하 텍스트 파일(노트)만 이 Mac에 내려받아 색인합니다.
            </span>
          )}
          <form action={setDownloadTextAction.bind(null, h.id, !h.downloadText)} className="ml-auto">
            <Button type="submit" size="sm" variant={h.downloadText ? "ghost" : "default"}>
              {h.downloadText ? "끄기" : "텍스트 파일 내려받기 켜기"}
            </Button>
          </form>
        </div>
      ))}
      <div className="min-h-0 flex-1">
        <GraphClient tags={tags} projects={projectRows} />
      </div>
    </div>
  );
}
