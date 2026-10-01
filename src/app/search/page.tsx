import Link from "next/link";
import { connection } from "next/server";
import { Highlighted, ItemRow } from "@/components/hub-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KIND_LABEL } from "@/lib/labels";
import { getDb } from "@/server/db";
import { sources } from "@/server/db/schema";
import { allTags } from "@/server/queries";
import { tagEmojiMap, tagWithEmoji } from "@/server/graph";
import { projects } from "@/server/db/schema";
import { DATE_RANGES, fromRecord, parseFilters } from "@/server/search/params";
import { hybridSearch } from "@/server/search/semantic";
import { Ollama, realOllama } from "@/server/ai/ollama";
import { getSettings } from "@/server/settings";

const PAGE = 30;

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  await connection();
  const sp = await searchParams;
  const p = fromRecord(sp);
  const q = p.get("q") ?? "";
  const page = Math.max(1, Number(p.get("page") ?? 1));
  const db = getDb();
  const filters = parseFilters(p);
  // 검색 방식: 섞어서(기본) / 키워드 / 의미. 의미 검색은 조각(임베딩)이 있을 때만
  const mode = (["keyword", "semantic", "hybrid"].includes(p.get("mode") ?? "") ? p.get("mode") : "hybrid") as "hybrid" | "keyword" | "semantic";
  const st = getSettings(db);
  const hasVectors = (db.$client.prepare(`SELECT count(*) FROM item_chunk_state`).pluck().get() as number) > 0;
  const ai = hasVectors ? new Ollama(realOllama()) : null;
  const r = q.trim() ? await hybridSearch(db, ai, st.aiEmbedModel, q, filters, PAGE, (page - 1) * PAGE, hasVectors ? mode : "keyword") : null;
  const modeHref = (m: string) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) for (const x of Array.isArray(v) ? v : v ? [v] : []) if (k !== "page" && k !== "mode") u.append(k, x);
    u.set("mode", m);
    return `/search?${u}`;
  };
  const srcs = db.select().from(sources).all();
  const tags = allTags(db, 50);
  const tagEmoji = tagEmojiMap(db);
  const projectRows = db.select().from(projects).all();
  const selSources = p.getAll("source");
  const selKinds = p.getAll("kind");

  const pageHref = (n: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) for (const x of Array.isArray(v) ? v : v ? [v] : []) if (k !== "page") u.append(k, x);
    u.set("page", String(n));
    return `/search?${u}`;
  };

  return (
    <div className="grid gap-6 md:grid-cols-[220px_1fr]">
      <form className="space-y-4 text-sm" action="/search">
        <Input name="q" defaultValue={q} placeholder="검색어" className="md:hidden" />
        <fieldset className="space-y-1">
          <legend className="mb-1 font-medium">소스</legend>
          {srcs.map((s) => (
            <label key={s.id} className="flex items-center gap-2">
              <input type="checkbox" name="source" value={s.id} defaultChecked={selSources.includes(String(s.id))} />
              <span className="truncate">{s.name}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="space-y-1">
          <legend className="mb-1 font-medium">형식</legend>
          {Object.entries(KIND_LABEL).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2">
              <input type="checkbox" name="kind" value={k} defaultChecked={selKinds.includes(k)} />
              {label}
            </label>
          ))}
        </fieldset>
        <fieldset className="space-y-1">
          <legend className="mb-1 font-medium">수정 날짜</legend>
          <select name="date" defaultValue={p.get("date") ?? ""} className="w-full rounded-md border bg-background px-2 py-1">
            <option value="">전체</option>
            {Object.entries(DATE_RANGES).map(([k, v]) => (
              <option key={k} value={k}>
                최근 {v.label}
              </option>
            ))}
          </select>
        </fieldset>
        {projectRows.length > 0 && (
          <fieldset className="space-y-1">
            <legend className="mb-1 font-medium">프로젝트</legend>
            <select name="project" defaultValue={p.get("project") ?? ""} className="w-full rounded-md border bg-background px-2 py-1">
              <option value="">전체</option>
              {projectRows.map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {pr.name}
                </option>
              ))}
            </select>
          </fieldset>
        )}
        {tags.length > 0 && (
          <fieldset className="space-y-1">
            <legend className="mb-1 font-medium">태그</legend>
            <select name="tag" defaultValue={p.get("tag") ?? ""} className="w-full rounded-md border bg-background px-2 py-1">
              <option value="">전체</option>
              {tags.map((t) => (
                <option key={t.name} value={t.name}>
                  {tagWithEmoji(t.name, tagEmoji)} ({t.n})
                </option>
              ))}
            </select>
          </fieldset>
        )}
        <Button type="submit" size="sm" className="w-full">
          필터 적용
        </Button>
      </form>

      <div>
        <form action="/search" className="mb-2 hidden md:block">
          <Input name="q" defaultValue={q} placeholder="검색어를 입력하세요" />
          <input type="hidden" name="mode" value={mode} />
        </form>
        <div className="mb-3 flex flex-wrap items-center gap-1 text-xs">
          {(
            [
              ["hybrid", "섞어서"],
              ["keyword", "키워드"],
              ["semantic", "의미"],
            ] as const
          ).map(([m, label]) => (
            <Link
              key={m}
              href={modeHref(m)}
              className={`rounded-full border px-2 py-0.5 ${mode === m ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"} ${!hasVectors && m !== "keyword" ? "pointer-events-none opacity-40" : ""}`}
            >
              {label}
            </Link>
          ))}
          <span className="text-muted-foreground">
            {hasVectors ? "의미 검색: 낱말이 달라도 뜻이 비슷한 문서를 찾습니다" : "의미 검색은 AI 정리를 켜면 쓸 수 있습니다"}
          </span>
        </div>
        {!r && <p className="text-sm text-muted-foreground">검색어를 입력하세요. 어디서든 ⌘K 로 검색창을 열 수 있습니다.</p>}
        {r && (
          <>
            <p className="mb-2 text-xs text-muted-foreground">
              {r.total.toLocaleString()}
              {r.capped ? "+" : ""}건 · {r.tookMs.toFixed(0)}ms · {r.mode === "hybrid" ? "섞어서" : r.mode === "semantic" ? "의미" : "키워드"}
              {r.capped && " (결과가 많아 일부만 정렬했습니다. 검색어나 필터를 더 구체적으로 입력하세요)"}
              {r.semanticNote && <span className="text-amber-600 dark:text-amber-400"> · {r.semanticNote}</span>}
            </p>
            <div className="divide-y">
              {r.hits.map((h) => (
                <ItemRow key={h.id} item={h}>
                  {"similarity" in h && typeof h.similarity === "number" && !h.highlights.length && (
                    <span className="ml-6 rounded bg-muted px-1.5 text-[10px] text-muted-foreground">뜻이 비슷함 {Math.round(h.similarity * 100)}%</span>
                  )}
                  {h.snippet && (
                    <p className="line-clamp-2 pl-6 text-sm">
                      <Highlighted text={h.snippet} ranges={h.highlights} />
                    </p>
                  )}
                </ItemRow>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              {page > 1 && (
                <Link href={pageHref(page - 1)} className="text-sm underline">
                  ← 이전
                </Link>
              )}
              {page * PAGE < r.total && (
                <Link href={pageHref(page + 1)} className="text-sm underline">
                  다음 →
                </Link>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
