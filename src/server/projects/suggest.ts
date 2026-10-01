import { eq } from "drizzle-orm";
import type { Db } from "../db";
import { folders, projectFolders, projects, projectSuggestions, sources } from "../db/schema";
import { getSettings } from "../settings";
import { createProject, linkFolder } from "./index";

/**
 * 폴더 이름 기반 연결 제안
 * 서로 다른 소스에 이름이 같거나 비슷한 폴더가 있으면 "같은 프로젝트로 묶을까요?"를 제안한다.
 * 비교 단계 (점수 높은 순):
 *  1. 정규화 이름 일치 (100): 대소문자·공백·-·_·. 무시, 날짜·버전 꼬리 제거
 *  2. 동의어 사전 일치 (90): "리뉴얼 = renewal" 같은 사용자 사전
 *  3. 발음 뼈대 일치 (70): 한글을 자음 소리 묶음으로 바꿔 영문과 비교 (블로그 ≈ blog)
 *  4. 일부 일치 (55): 한 단어짜리 폴더 이름이 다른 폴더 이름의 단어 중 하나와 같음 (blog ⊂ 블로그 리뉴얼)
 */

/** 프로젝트 이름으로 보기 어려운 흔한 폴더 이름 */
const COMMON = new Set(
  "src lib app apps docs doc assets asset images image img imgs static public build dist out bin test tests tmp temp cache backup backups archive archives old new misc etc data files file downloads download desktop documents photos photo pictures videos video music media attachments attachment resources resource projects project areas area inbox notes note daily weekly monthly templates template config configs scripts node_modules 첨부 첨부파일 사진 이미지 문서 자료 기타 임시 백업 새폴더 무제 무제폴더 untitled untitledfolder".split(
    " ",
  ),
);


const STRIP_SUFFIX: RegExp[] = [
  /\(\d+\)$/, // (1)
  /(copy|사본|복사본)\s*\d*$/i,
  /[\s_\-.]*(v|ver|version)\s*\d+(\.\d+)*$/i, // _v2, ver3, v1.2
  /[\s_\-.]*(final|최종|수정본)$/i,
  /[\s_\-.]*(19|20)\d{2}([\s_\-.]*\d{1,2}){0,2}(년|월|일)?$/, // 2026, 2026-09, 2026.9.30
  /[\s_\-.]*\d{6,8}$/, // 260930, 20260930
];
const STRIP_PREFIX: RegExp[] = [/^\d{1,3}[\s_\-.]+/, /^(19|20)\d{2}([\s_\-.]*\d{1,2}){0,2}[\s_\-.]+/];

/** 비교용으로 이름 정리: 날짜·버전 꼬리, 번호 머리 제거 */
export function cleanName(name: string): string {
  let s = name.normalize("NFC").trim().toLowerCase();
  for (let i = 0; i < 3; i++) {
    const before = s;
    for (const re of STRIP_SUFFIX) s = s.replace(re, "").trim();
    for (const re of STRIP_PREFIX) s = s.replace(re, "").trim();
    if (s === before) break;
  }
  return s;
}

export const normalizeName = (name: string) => cleanName(name).replace(/[\s\-_.·,()[\]]+/g, "");

export function tokens(name: string): string[] {
  return cleanName(name)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(/[\s\-_.·,()[\]]+/)
    .filter(Boolean);
}

// ---------- 발음 뼈대 ----------
// 한글 자음과 영문 자음을 같은 소리 묶음으로 바꾼다. 모음·ㅇ(초성)·w·y 는 버린다.
const CHO = ["G", "G", "N", "D", "D", "L", "M", "B", "B", "S", "S", "", "S", "S", "S", "G", "D", "B", "H"];
const JONG = ["", "G", "G", "G", "N", "N", "N", "D", "L", "LG", "LM", "LB", "LS", "LD", "LB", "LH", "M", "B", "BS", "S", "S", "N", "S", "S", "G", "D", "B", "H"];

export function skeleton(s: string): string {
  let out = "";
  const lower = s.normalize("NFC").toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    const c = lower[i];
    const code = c.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      const n = code - 0xac00;
      out += CHO[Math.floor(n / 588)] + JONG[n % 28];
      continue;
    }
    const two = lower.slice(i, i + 2);
    if (two === "ch" || two === "sh") {
      out += "S";
      i++;
      continue;
    }
    if (two === "th") {
      out += "D";
      i++;
      continue;
    }
    if (two === "ph") {
      out += "B";
      i++;
      continue;
    }
    if (two === "ck") {
      out += "G";
      i++;
      continue;
    }
    if (two === "ng") {
      out += "N";
      i++;
      continue;
    }
    const map: Record<string, string> = { g: "G", k: "G", q: "G", c: "G", x: "GS", d: "D", t: "D", b: "B", p: "B", f: "B", v: "B", s: "S", z: "S", j: "S", l: "L", r: "L", m: "M", n: "N", h: "H" };
    if (map[c]) out += map[c];
    else if (/[0-9]/.test(c)) out += c;
  }
  return out.replace(/(.)\1+/g, "$1");
}

// ---------- 동의어 ----------
export function parseSynonyms(lines: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const l of lines) {
    const parts = l.split("=").map((x) => normalizeName(x)).filter(Boolean);
    if (parts.length < 2) continue;
    const canon = parts[parts.length - 1];
    for (const p of parts) m.set(p, canon);
  }
  return m;
}

function dictKey(name: string, syn: Map<string, string>): string | null {
  const t = tokens(name).map((x) => normalizeName(x));
  let changed = false;
  const mapped = t.map((x) => {
    const c = syn.get(x);
    if (c) changed = true;
    return c ?? x;
  });
  return changed ? mapped.join("") : null;
}

// ---------- 후보 폴더 ----------
export type Candidate = { id: number; name: string; path: string; sourceId: number; sourceName: string };

function candidates(db: Db): Candidate[] {
  const rows = db
    .select({ id: folders.id, name: folders.name, path: folders.path, sourceId: sources.id, sourceName: sources.name, root: sources.rootPath })
    .from(folders)
    .innerJoin(sources, eq(sources.id, folders.sourceId))
    .where(eq(folders.state, "ok"))
    .all();
  return rows.filter((f) => {
    if (f.path === f.root) return false;
    const depth = f.path.slice(f.root.length).split("/").filter(Boolean).length;
    if (depth > 3) return false; // 깊은 하위 폴더(src/components 등)는 프로젝트 후보에서 뺀다
    const n = normalizeName(f.name);
    return n.length >= 2 && !COMMON.has(n) && !/^\d+$/.test(n);
  });
}

export type SuggestionDraft = { folderIds: number[]; name: string; reason: string; score: number };

/** 제안 목록 계산 (DB에 쓰지 않음) */
export function computeSuggestions(db: Db): SuggestionDraft[] {
  const syn = parseSynonyms(getSettings(db).synonyms);
  const cands = candidates(db);
  const groups = new Map<string, { score: number; label: string; ids: Set<number> }>();
  const add = (key: string, score: number, label: string, id: number) => {
    const g = groups.get(key) ?? { score, label, ids: new Set<number>() };
    g.ids.add(id);
    groups.set(key, g);
  };
  const byId = new Map(cands.map((c) => [c.id, c]));
  for (const c of cands) {
    const n = normalizeName(c.name);
    add(`norm:${n}`, 100, "이름이 같음", c.id);
    const d = dictKey(c.name, syn);
    if (d) add(`dict:${d}`, 90, "동의어 사전으로 같은 이름", c.id);
    const sk = skeleton(n);
    if (sk.replace(/\d/g, "").length >= 3) add(`skel:${sk}`, 70, "한글·영문 표기만 다름", c.id);
  }
  // 일부 일치: 한 단어 폴더 이름이 다른 폴더 이름의 단어와 같음
  // 단어가 그대로 같거나(동의어 포함), 발음 뼈대가 4자 이상 같을 때만. 짧은 뼈대는 우연히 겹치기 쉽다 (tools ≈ 테트라워치)
  const tokenKeys = (t: string) => {
    const n = syn.get(normalizeName(t)) ?? normalizeName(t);
    const keys = n.length >= 2 ? [`w:${n}`] : [];
    const sk = skeleton(n);
    if (sk.replace(/\d/g, "").length >= 4) keys.push(`s:${sk}`);
    return keys;
  };
  const tokenIndex = new Map<string, Set<number>>();
  for (const c of cands) {
    for (const t of tokens(c.name)) {
      for (const k of tokenKeys(t)) {
        if (!tokenIndex.has(k)) tokenIndex.set(k, new Set());
        tokenIndex.get(k)!.add(c.id);
      }
    }
  }
  for (const c of cands) {
    const t = tokens(c.name);
    if (t.length !== 1) continue;
    for (const k of tokenKeys(t[0])) {
      for (const other of tokenIndex.get(k) ?? []) {
        if (other === c.id) continue;
        add(`part:${c.id}`, 55, `'${c.name}' 이(가) 다른 폴더 이름의 일부`, c.id);
        add(`part:${c.id}`, 55, `'${c.name}' 이(가) 다른 폴더 이름의 일부`, other);
      }
    }
  }

  // 서로 다른 소스의 폴더가 2개 이상인 묶음만
  const drafts: SuggestionDraft[] = [];
  for (const g of groups.values()) {
    const ids = [...g.ids].sort((a, b) => a - b);
    const srcCount = new Set(ids.map((id) => byId.get(id)!.sourceId)).size;
    if (srcCount < 2) continue;
    const members = ids.map((id) => byId.get(id)!);
    const reason = `${g.label}: ` + members.map((m) => `${m.sourceName}/${m.name}`).join(", ");
    // 제안 이름: 한글이 들어간 이름을 우선, 그다음 가장 긴 이름
    const name = cleanName([...members].sort((a, b) => Number(/[가-힣]/.test(b.name)) - Number(/[가-힣]/.test(a.name)) || b.name.length - a.name.length)[0].name) || members[0].name;
    drafts.push({ folderIds: ids, name: members.find((m) => cleanName(m.name) === name)?.name.normalize("NFC") ?? name, reason, score: g.score });
  }
  // 같은 폴더 묶음은 점수 높은 것만, 다른 묶음의 부분집합이면서 점수가 낮거나 같으면 뺀다
  drafts.sort((a, b) => b.score - a.score || b.folderIds.length - a.folderIds.length);
  const kept: SuggestionDraft[] = [];
  for (const d of drafts) {
    const covered = kept.some((k) => k.score >= d.score && d.folderIds.every((id) => k.folderIds.includes(id)));
    if (!covered) kept.push(d);
  }
  return kept;
}

/**
 * 제안을 새로 계산해 저장한다.
 * - 이미 같은 프로젝트에 모두 연결된 묶음, 서로 다른 프로젝트에 연결된 묶음은 제안하지 않는다.
 * - 한 폴더라도 프로젝트에 연결돼 있으면 "그 프로젝트에 추가" 제안이 된다.
 * - 거절·수락한 제안(같은 폴더 묶음)은 다시 띄우지 않는다.
 */
export function refreshSuggestions(db: Db): number {
  const drafts = computeSuggestions(db);
  const linkRows = db.select({ folderId: projectFolders.folderId, projectId: projectFolders.projectId }).from(projectFolders).all();
  const linked = new Map<number, Set<number>>();
  for (const l of linkRows) {
    if (!linked.has(l.folderId)) linked.set(l.folderId, new Set());
    linked.get(l.folderId)!.add(l.projectId);
  }
  const existing = new Map(db.select().from(projectSuggestions).all().map((s) => [s.key, s]));
  const seenKeys = new Set<string>();
  let n = 0;
  for (const d of drafts) {
    const key = d.folderIds.join(",");
    seenKeys.add(key);
    const projectIds = new Set(d.folderIds.flatMap((id) => [...(linked.get(id) ?? [])]));
    if (projectIds.size > 1) continue;
    const projectId = projectIds.size === 1 ? [...projectIds][0] : null;
    if (projectId && d.folderIds.every((id) => linked.get(id)?.has(projectId))) continue;
    const prev = existing.get(key);
    if (prev && prev.status !== "pending") continue;
    const row = { key, projectId, folderIds: d.folderIds, suggestedName: d.name, reason: d.reason, score: d.score };
    if (prev) db.update(projectSuggestions).set(row).where(eq(projectSuggestions.id, prev.id)).run();
    else db.insert(projectSuggestions).values({ ...row, createdAt: Date.now() }).run();
    n++;
  }
  // 더 이상 해당하지 않는 대기 중 제안은 지운다 (거절 기록은 남긴다)
  for (const [key, s] of existing) if (s.status === "pending" && !seenKeys.has(key)) db.delete(projectSuggestions).where(eq(projectSuggestions.id, s.id)).run();
  return n;
}

export function pendingSuggestions(db: Db) {
  const rows = db.select().from(projectSuggestions).where(eq(projectSuggestions.status, "pending")).all();
  const fmap = new Map(
    db
      .select({ id: folders.id, path: folders.path, name: folders.name, sourceName: sources.name, sourceKind: sources.kind })
      .from(folders)
      .innerJoin(sources, eq(sources.id, folders.sourceId))
      .all()
      .map((f) => [f.id, f]),
  );
  const pmap = new Map(db.select().from(projects).all().map((p) => [p.id, p.name]));
  return rows
    .map((s) => ({ ...s, projectName: s.projectId ? (pmap.get(s.projectId) ?? null) : null, folders: s.folderIds.map((id) => fmap.get(id)).filter((f) => !!f) }))
    .filter((s) => s.folders.length >= 2)
    .sort((a, b) => b.score - a.score);
}

/** 수락해야만 연결한다 */
export function acceptSuggestion(db: Db, id: number, name?: string): number {
  const s = db.select().from(projectSuggestions).where(eq(projectSuggestions.id, id)).get();
  if (!s || s.status !== "pending") throw new Error("이미 처리된 제안입니다.");
  let projectId = s.projectId;
  if (!projectId) projectId = createProject(db, name?.trim() || s.suggestedName).id;
  for (const fid of s.folderIds) linkFolder(db, projectId, fid, { addedBy: "suggestion" });
  db.update(projectSuggestions).set({ status: "accepted", projectId, decidedAt: Date.now() }).where(eq(projectSuggestions.id, id)).run();
  return projectId;
}

export function rejectSuggestion(db: Db, id: number) {
  db.update(projectSuggestions).set({ status: "rejected", decidedAt: Date.now() }).where(eq(projectSuggestions.id, id)).run();
}
