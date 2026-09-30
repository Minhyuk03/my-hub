import path from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "./db";
import { tagStyles } from "./db/schema";
import { membershipSql } from "./projects";

/**
 * 그래프 뷰 데이터: 노트는 점, [[위키링크]]는 선. 태그를 켜면 태그도 점이 되고 노트와 이어진다.
 * 위키링크 대상은 Obsidian 과 같은 방식으로 찾는다: 노트 이름 → 파일 이름 → 경로 끝부분.
 */
export type GraphNode = {
  id: string;
  type: "note" | "file" | "tag";
  label: string;
  itemId?: number;
  tag?: string;
  group: string;
  degree: number;
  emoji?: string;
};
export type GraphLink = { source: string; target: string; kind: "link" | "tag" };
export type GraphOptions = {
  projectId?: number;
  sourceIds?: number[];
  includeTags?: boolean;
  includeAttachments?: boolean;
  includeOrphans?: boolean;
  colorBy?: "folder" | "tag" | "source";
};

type Row = { id: number; path: string; title: string; kind: string; ext: string; sourceId: number; root: string; sourceName: string };

const norm = (s: string) => s.normalize("NFC").toLowerCase();

/** 메인 태그 = 최상위 태그 ("para/resource" → "para") */
export const mainTagOf = (tag: string) => tag.split("/")[0];

export function tagEmojiMap(db: Db): Map<string, string> {
  return new Map(db.select().from(tagStyles).all().map((t) => [t.name, t.emoji]));
}

export function buildGraph(db: Db, opts: GraphOptions = {}): { nodes: GraphNode[]; links: GraphLink[]; stats: { notes: number; links: number; tags: number } } {
  const c = db.$client;
  const all = c
    .prepare(
      `SELECT i.id, i.path, i.title, i.kind, i.ext, i.source_id AS sourceId, s.root_path AS root, s.name AS sourceName
       FROM items i JOIN sources s ON s.id = i.source_id WHERE i.state != 'deleted'`,
    )
    .all() as Row[];

  // 그래프에 올릴 노트 (프로젝트·소스 필터)
  let allowed: Set<number> | null = null;
  if (opts.projectId) {
    const m = membershipSql(db, opts.projectId);
    allowed = new Set(c.prepare(m.sql).pluck().all(...m.params) as number[]);
  }
  const notes = all.filter(
    (r) => r.kind === "note" && (!allowed || allowed.has(r.id)) && (!opts.sourceIds?.length || opts.sourceIds.includes(r.sourceId)),
  );
  const noteIds = new Set(notes.map((n) => n.id));

  // 위키링크 대상 찾기용 색인
  const byTitle = new Map<string, Row>();
  const byFile = new Map<string, Row>();
  for (const r of [...all].sort((a, b) => a.path.length - b.path.length)) {
    const base = norm(path.basename(r.path));
    if (r.kind === "note" && !byTitle.has(norm(r.title))) byTitle.set(norm(r.title), r);
    if (!byFile.has(base)) byFile.set(base, r);
  }
  const resolve = (target: string): Row | undefined => {
    const t = norm(target.trim());
    if (!t) return undefined;
    const direct = byTitle.get(t) ?? byFile.get(t) ?? byFile.get(`${t}.md`);
    if (direct) return direct;
    if (t.includes("/")) {
      const base = t.split("/").pop()!;
      const cand = byTitle.get(base) ?? byFile.get(base);
      if (cand && norm(cand.path).includes(`/${t}`)) return cand;
    }
    return undefined;
  };

  const emoji = tagEmojiMap(db);
  const nodes = new Map<string, GraphNode>();
  const links: GraphLink[] = [];
  const noteTags = new Map<number, string[]>();

  if (opts.includeTags || opts.colorBy === "tag") {
    const rows = c.prepare(`SELECT it.item_id AS id, g.name FROM item_tags it JOIN tags g ON g.id = it.tag_id`).all() as { id: number; name: string }[];
    for (const r of rows) if (noteIds.has(r.id)) noteTags.set(r.id, [...(noteTags.get(r.id) ?? []), r.name]);
  }

  const groupOf = (r: Row): string => {
    if (opts.colorBy === "source") return r.sourceName;
    if (opts.colorBy === "tag") {
      const t = noteTags.get(r.id)?.[0];
      return t ? mainTagOf(t) : "(태그 없음)";
    }
    const rel = r.path.slice(r.root.length + 1).split("/");
    return rel.length > 1 ? rel[0].normalize("NFC") : "(최상위)";
  };

  for (const n of notes) nodes.set(`n${n.id}`, { id: `n${n.id}`, type: "note", label: n.title, itemId: n.id, group: groupOf(n), degree: 0 });

  // 노트 → 노트 / 첨부파일 링크
  const linkRows = c.prepare(`SELECT item_id AS id, target FROM item_links`).all() as { id: number; target: string }[];
  const seen = new Set<string>();
  for (const l of linkRows) {
    if (!noteIds.has(l.id)) continue;
    const t = resolve(l.target);
    if (!t || t.id === l.id) continue;
    let tid: string;
    if (noteIds.has(t.id)) tid = `n${t.id}`;
    else if (t.kind !== "note" && opts.includeAttachments) {
      tid = `f${t.id}`;
      if (!nodes.has(tid)) nodes.set(tid, { id: tid, type: "file", label: path.basename(t.path).normalize("NFC"), itemId: t.id, group: "(첨부파일)", degree: 0 });
    } else continue;
    const key = `n${l.id}>${tid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ source: `n${l.id}`, target: tid, kind: "link" });
  }

  // 노트 → 태그
  if (opts.includeTags) {
    for (const [id, tags] of noteTags) {
      for (const t of tags) {
        const tid = `t${t}`;
        if (!nodes.has(tid)) nodes.set(tid, { id: tid, type: "tag", label: `#${t}`, tag: t, group: "(태그)", degree: 0, emoji: emoji.get(mainTagOf(t)) });
        links.push({ source: `n${id}`, target: tid, kind: "tag" });
      }
    }
  }

  for (const l of links) {
    nodes.get(l.source)!.degree++;
    nodes.get(l.target)!.degree++;
  }
  let list = [...nodes.values()];
  if (!opts.includeOrphans) list = list.filter((n) => n.degree > 0);
  const keep = new Set(list.map((n) => n.id));
  const kept = links.filter((l) => keep.has(l.source) && keep.has(l.target));
  return {
    nodes: list,
    links: kept,
    stats: { notes: list.filter((n) => n.type === "note").length, links: kept.filter((l) => l.kind === "link").length, tags: list.filter((n) => n.type === "tag").length },
  };
}

/** 태그 창: 메인 태그별 개수와 하위 태그, 이모지 */
export function tagTree(db: Db) {
  const rows = db.$client
    .prepare(
      `SELECT g.name, count(DISTINCT it.item_id) AS n FROM tags g JOIN item_tags it ON it.tag_id = g.id
       JOIN items i ON i.id = it.item_id WHERE i.state != 'deleted' GROUP BY g.id`,
    )
    .all() as { name: string; n: number }[];
  const emoji = tagEmojiMap(db);
  const main = new Map<string, { name: string; count: number; emoji?: string; children: { name: string; count: number }[] }>();
  for (const r of rows) {
    const m = mainTagOf(r.name);
    const e = main.get(m) ?? { name: m, count: 0, emoji: emoji.get(m), children: [] };
    e.count += r.n;
    if (r.name !== m) e.children.push({ name: r.name, count: r.n });
    main.set(m, e);
  }
  return [...main.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko"));
}

/** 이모지 한 글자인지 확인 (피부색·결합 이모지 포함) */
export function isSingleEmoji(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 16) return false;
  const seg = [...new Intl.Segmenter("ko", { granularity: "grapheme" }).segment(t)];
  return seg.length === 1 && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(t);
}

export function setTagEmoji(db: Db, tag: string, emoji: string) {
  const name = mainTagOf(tag.normalize("NFC"));
  if (!emoji.trim()) {
    db.delete(tagStyles).where(eq(tagStyles.name, name)).run();
    return;
  }
  if (!isSingleEmoji(emoji)) throw new Error("이모지 하나만 넣을 수 있습니다.");
  db.insert(tagStyles).values({ name, emoji: emoji.trim() }).onConflictDoUpdate({ target: tagStyles.name, set: { emoji: emoji.trim() } }).run();
}

/** 화면 표시용: "📚 공부" */
export function tagWithEmoji(tag: string, emoji: Map<string, string>) {
  const e = emoji.get(mainTagOf(tag));
  return e ? `${e} ${tag}` : tag;
}
