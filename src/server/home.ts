import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { asc, eq, isNull } from "drizzle-orm";
import type { Db } from "./db";
import { bookmarkGroups, bookmarks, folders, projects, shortcuts, sources } from "./db/schema";

// ---------- 주소 검사 ----------
const ALLOWED = new Set(["http:", "https:", "obsidian:", "mailto:", "notion:", "figma:"]);

/** 북마크 주소 정리. javascript: 같은 위험한 주소는 거부한다. 도메인만 쓰면 https:// 를 붙인다. */
export function safeUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (!ALLOWED.has(u.protocol)) return null;
    if ((u.protocol === "http:" || u.protocol === "https:") && !u.hostname) return null;
    return u.toString();
  } catch {
    return null;
  }
}

// ---------- 북마크 바 ----------
export type BookmarkBar = {
  root: (typeof bookmarks.$inferSelect)[];
  groups: ((typeof bookmarkGroups.$inferSelect) & { items: (typeof bookmarks.$inferSelect)[] })[];
};

export function bookmarkBar(db: Db): BookmarkBar {
  const all = db.select().from(bookmarks).orderBy(asc(bookmarks.order), asc(bookmarks.id)).all();
  const groups = db.select().from(bookmarkGroups).orderBy(asc(bookmarkGroups.order), asc(bookmarkGroups.id)).all();
  return {
    root: all.filter((b) => b.groupId == null),
    groups: groups.map((g) => ({ ...g, items: all.filter((b) => b.groupId === g.id) })),
  };
}

const nextOrder = (rows: { order: number }[]) => (rows.length ? Math.max(...rows.map((r) => r.order)) + 1 : 0);

export function addGroup(db: Db, name: string) {
  const n = name.trim().normalize("NFC");
  if (!n) throw new Error("폴더 이름을 입력하세요.");
  return db.insert(bookmarkGroups).values({ name: n, order: nextOrder(db.select().from(bookmarkGroups).all()) }).returning().get();
}

export function renameGroup(db: Db, id: number, name: string) {
  const n = name.trim().normalize("NFC");
  if (n) db.update(bookmarkGroups).set({ name: n }).where(eq(bookmarkGroups.id, id)).run();
}

export function deleteGroup(db: Db, id: number) {
  db.delete(bookmarks).where(eq(bookmarks.groupId, id)).run();
  db.delete(bookmarkGroups).where(eq(bookmarkGroups.id, id)).run();
}

export function addBookmark(db: Db, groupId: number | null, title: string, url: string) {
  const u = safeUrl(url);
  if (!u) throw new Error("주소가 올바르지 않습니다. (http, https, obsidian 등만 가능)");
  const siblings = db.select().from(bookmarks).where(groupId == null ? isNull(bookmarks.groupId) : eq(bookmarks.groupId, groupId)).all();
  return db
    .insert(bookmarks)
    .values({ groupId, title: title.trim().normalize("NFC") || new URL(u).hostname || u, url: u, order: nextOrder(siblings) })
    .returning()
    .get();
}

export function deleteBookmark(db: Db, id: number) {
  db.delete(bookmarks).where(eq(bookmarks.id, id)).run();
}

type Orderable = typeof bookmarks | typeof bookmarkGroups | typeof shortcuts;

/** 같은 목록 안에서 한 칸 앞/뒤로 옮긴다 */
export function move(db: Db, table: Orderable, id: number, dir: -1 | 1) {
  const t = table as typeof shortcuts;
  const me = db.select().from(t).where(eq(t.id, id)).get() as { id: number; order: number; groupId?: number | null } | undefined;
  if (!me) return;
  let siblings = db.select().from(t).orderBy(asc(t.order), asc(t.id)).all() as { id: number; order: number; groupId?: number | null }[];
  if (table === bookmarks) siblings = siblings.filter((s) => (s.groupId ?? null) === (me.groupId ?? null));
  const i = siblings.findIndex((s) => s.id === id);
  const j = i + dir;
  if (j < 0 || j >= siblings.length) return;
  [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
  siblings.forEach((s, k) => db.update(t).set({ order: k }).where(eq(t.id, s.id)).run());
}

// ---------- 즐겨찾기 타일 ----------
export type Tile = { id: number; kind: "folder" | "project" | "url"; title: string; href: string; subtitle: string; warning?: string; sourceKind?: string };

export function tiles(db: Db): Tile[] {
  return db
    .select()
    .from(shortcuts)
    .orderBy(asc(shortcuts.order), asc(shortcuts.id))
    .all()
    .map((s): Tile => {
      if (s.kind === "folder") {
        const f = db
          .select({ id: folders.id, path: folders.path, state: folders.state, sourceKind: sources.kind, sourceStatus: sources.status })
          .from(folders)
          .innerJoin(sources, eq(sources.id, folders.sourceId))
          .where(eq(folders.id, Number(s.target)))
          .get();
        return {
          id: s.id,
          kind: "folder",
          title: s.title,
          href: `/folders/${s.target}`,
          subtitle: f ? f.path.normalize("NFC").replace(/^\/Users\/[^/]+/, "~") : "",
          sourceKind: f?.sourceKind,
          warning: !f || f.state === "deleted" ? "폴더 없음" : f.sourceStatus === "offline" ? "오프라인" : undefined,
        };
      }
      if (s.kind === "project") {
        const p = db.select().from(projects).where(eq(projects.id, Number(s.target))).get();
        return { id: s.id, kind: "project", title: s.title, href: `/projects/${s.target}`, subtitle: "프로젝트", warning: p ? undefined : "프로젝트 없음" };
      }
      let host = s.target;
      try {
        host = new URL(s.target).hostname || s.target;
      } catch {}
      return { id: s.id, kind: "url", title: s.title, href: s.target, subtitle: host };
    });
}

export function addTile(db: Db, kind: Tile["kind"], target: string, title?: string) {
  let t = target;
  let name = title?.trim().normalize("NFC") ?? "";
  if (kind === "url") {
    const u = safeUrl(target);
    if (!u) throw new Error("주소가 올바르지 않습니다.");
    t = u;
    name ||= new URL(u).hostname;
  } else if (kind === "folder") {
    const f = db.select().from(folders).where(eq(folders.id, Number(target))).get();
    if (!f) throw new Error("폴더를 찾을 수 없습니다.");
    name ||= f.name;
  } else {
    const p = db.select().from(projects).where(eq(projects.id, Number(target))).get();
    if (!p) throw new Error("프로젝트를 찾을 수 없습니다.");
    name ||= p.name;
  }
  return db.insert(shortcuts).values({ kind, target: t, title: name, order: nextOrder(db.select().from(shortcuts).all()) }).returning().get();
}

export function deleteTile(db: Db, id: number) {
  db.delete(shortcuts).where(eq(shortcuts.id, id)).run();
}

// ---------- Chrome 북마크 바 가져오기 ----------
export const CHROME_BOOKMARKS = path.join(os.homedir(), "Library/Application Support/Google/Chrome/Default/Bookmarks");

type ChromeNode = { type: "url" | "folder"; name: string; url?: string; children?: ChromeNode[] };
export type ChromeBar = { root: { title: string; url: string }[]; groups: { name: string; items: { title: string; url: string }[] }[] };

/** Chrome 북마크 파일(JSON)에서 북마크 바만 읽는다. 폴더 안의 하위 폴더는 펼쳐서 한 목록으로 만든다. */
export function parseChromeBookmarks(json: string): ChromeBar {
  const data = JSON.parse(json) as { roots?: { bookmark_bar?: ChromeNode } };
  const bar = data.roots?.bookmark_bar?.children ?? [];
  const flatten = (n: ChromeNode): { title: string; url: string }[] =>
    n.type === "url" && n.url ? [{ title: n.name, url: n.url }] : (n.children ?? []).flatMap(flatten);
  const root: ChromeBar["root"] = [];
  const groups: ChromeBar["groups"] = [];
  for (const n of bar) {
    if (n.type === "url" && n.url) root.push({ title: n.name, url: n.url });
    else if (n.type === "folder") groups.push({ name: n.name, items: flatten(n) });
  }
  return { root, groups };
}

export function readChromeBar(file = CHROME_BOOKMARKS): ChromeBar | null {
  try {
    return parseChromeBookmarks(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** 가져오기: 같은 이름의 폴더가 있으면 거기에 없는 주소만 더한다 (중복 없이) */
export function importChromeBar(db: Db, bar: ChromeBar) {
  let added = 0;
  const current = bookmarkBar(db);
  const has = (list: { url: string }[], url: string) => list.some((b) => b.url === url);
  for (const b of bar.root) {
    const u = safeUrl(b.url);
    if (u && !has(current.root, u)) {
      addBookmark(db, null, b.title, u);
      added++;
    }
  }
  for (const g of bar.groups) {
    const existing = current.groups.find((x) => x.name === g.name.normalize("NFC"));
    const gid = existing?.id ?? addGroup(db, g.name).id;
    for (const b of g.items) {
      const u = safeUrl(b.url);
      if (u && !has(existing?.items ?? [], u)) {
        addBookmark(db, gid, b.title, u);
        added++;
      }
    }
  }
  return added;
}

/**
 * 브라우저에서 "북마크 내보내기"로 만든 HTML(Netscape 형식)을 읽는다. Chrome·Safari·Edge 공통.
 * 북마크 바 폴더(PERSONAL_TOOLBAR_FOLDER)가 있으면 그 안만, 없으면 최상위를 쓴다.
 */
export function parseBookmarkHtml(html: string): ChromeBar {
  type Node = { type: "folder" | "url"; name: string; url?: string; toolbar?: boolean; children: Node[] };
  const root: Node = { type: "folder", name: "", children: [] };
  const stack: Node[] = [root];
  let pendingFolder: Node | null = null;
  const re = /<DT><H3([^>]*)>([\s\S]*?)<\/H3>|<DT><A([^>]*)>([\s\S]*?)<\/A>|<DL>|<\/DL>/gi;
  const decode = (t: string) =>
    t.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();
  for (const m of html.matchAll(re)) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) {
      pendingFolder = { type: "folder", name: decode(m[2]), toolbar: /PERSONAL_TOOLBAR_FOLDER\s*=\s*"true"/i.test(m[1]), children: [] };
      top.children.push(pendingFolder);
    } else if (m[3] !== undefined) {
      const href = m[3].match(/HREF\s*=\s*"([^"]*)"/i)?.[1];
      if (href) top.children.push({ type: "url", name: decode(m[4]), url: decode(href), children: [] });
    } else if (m[0].toUpperCase() === "<DL>") {
      if (pendingFolder) stack.push(pendingFolder);
      pendingFolder = null;
    } else if (stack.length > 1) stack.pop();
  }
  const find = (n: Node): Node | null => (n.toolbar ? n : n.children.reduce<Node | null>((f, c) => f ?? (c.type === "folder" ? find(c) : null), null));
  const bar = find(root) ?? (root.children.length === 1 && root.children[0].type === "folder" ? root.children[0] : root);
  const flatten = (n: Node): { title: string; url: string }[] => (n.type === "url" ? [{ title: n.name, url: n.url! }] : n.children.flatMap(flatten));
  return {
    root: bar.children.filter((c) => c.type === "url").map((c) => ({ title: c.name, url: c.url! })),
    groups: bar.children.filter((c) => c.type === "folder").map((c) => ({ name: c.name, items: flatten(c) })),
  };
}

// ---------- 배경 이미지 ----------
export const BG_EXT = ["jpg", "jpeg", "png", "webp", "gif"];
