/**
 * Figma 동기화 (등록한 팀 또는 프로젝트 단위)
 * - 팀 → 프로젝트(폴더) → 파일(항목). 기본은 목록 정보(이름·수정 시각·미리보기)만.
 * - "본문 텍스트" 옵션을 켜면 바뀐 파일만 페이지·프레임 이름과 글자를 받아 색인한다 (하루 상한).
 * - 전체 확인이 끝까지 성공했을 때만 사라진 파일·프로젝트를 deleted 로 표시한다.
 * - 토큰 오류·요청 한도·네트워크 끊김은 오프라인으로 표시하고 지우지 않는다.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "../../db";
import { items, scanJobs, sources } from "../../db/schema";
import { writeItemText } from "../../search/index-writer";
import { getSettings } from "../../settings";
import { finalizeDeletions, purgeExcluded } from "../../sync/scanner";
import { cloudPathLabel, patchSourceConfig, seg, upsertCloudFolder } from "../common";
import { figmaFileUrl, FigmaAuthError, FigmaNotFound, FigmaRateLimit, figmaText, type FigmaClient, type FgFile } from "./client";

type Source = typeof sources.$inferSelect;
export type FigmaConfig = {
  target: "team" | "project";
  id: string;
  name?: string;
  /** 파일 내용(글자)도 가져오기 — 요청 한도를 쓴다 */
  fetchText?: boolean;
  /** 하루에 내용을 받을 최대 파일 수 */
  dailyTextLimit?: number;
  textCount?: { day: string; n: number };
};
export type FigmaSyncDeps = { client: FigmaClient; now: () => number; shouldAbort?: () => boolean };

export const figmaRoot = (target: "team" | "project", id: string) => `figma:/${target === "team" ? "t" : "p"}${id}`;
const ts = (iso?: string) => (iso ? Date.parse(iso) : null);

function classify(e: unknown): { status: "offline" | "error"; message: string } {
  if (e instanceof FigmaAuthError || e instanceof FigmaNotFound || e instanceof FigmaRateLimit) return { status: "offline", message: e.message };
  const msg = e instanceof Error ? e.message : String(e);
  if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network/i.test(msg)) return { status: "offline", message: "네트워크에 연결할 수 없습니다." };
  return { status: "error", message: msg };
}

/** 오늘 내용을 더 받아도 되는지 (하루 상한) */
function textBudget(db: Db, src: Source, now: number): { ok: boolean; take: () => void } {
  // 같은 확인 중에도 횟수가 늘어나므로 매번 DB 에서 최신 값을 읽는다
  const cfg = ((db.select({ c: sources.config }).from(sources).where(eq(sources.id, src.id)).get()?.c ?? {}) as FigmaConfig);
  if (!cfg.fetchText) return { ok: false, take: () => {} };
  const day = new Date(now).toISOString().slice(0, 10);
  const used = cfg.textCount?.day === day ? cfg.textCount.n : 0;
  const limit = cfg.dailyTextLimit ?? 20;
  return {
    ok: used < limit,
    take: () => {
      const cur = ((db.select({ c: sources.config }).from(sources).where(eq(sources.id, src.id)).get()?.c ?? {}) as FigmaConfig).textCount;
      const n = cur?.day === day ? cur.n + 1 : 1;
      patchSourceConfig(db, src.id, { textCount: { day, n } });
    },
  };
}

export async function processFigmaFile(db: Db, src: Source, client: FigmaClient, f: FgFile, projectPath: string, folderId: number, jobId: number | null, now: number) {
  const path = `${projectPath}/${seg(f.name, f.key)}`;
  const title = f.name.normalize("NFC");
  const existing = db.select().from(items).where(and(eq(items.sourceId, src.id), eq(items.externalId, f.key))).get();
  const budget = textBudget(db, src, now);
  const hasText = existing?.noContentReason == null && existing?.state === "ok" && (existing.size ?? 0) > 0;
  const unchanged = existing && existing.state !== "deleted" && existing.contentHash === f.last_modified && (hasText || !budget.ok);
  if (unchanged) {
    const patch: Partial<typeof items.$inferInsert> = { previewText: f.thumbnail_url ?? existing.previewText };
    if (existing.path !== path || existing.title !== title || existing.folderId !== folderId) Object.assign(patch, { path, title, folderId });
    if (jobId) patch.seenScanId = jobId;
    db.update(items).set(patch).where(eq(items.id, existing.id)).run();
    if (patch.path) {
      const body = (db.$client.prepare(`SELECT body FROM item_text WHERE item_id = ?`).pluck().get(existing.id) as string | undefined) ?? "";
      writeItemText(db, existing.id, { title, path: cloudPathLabel(path), body });
    }
    return;
  }
  let body = "";
  if (budget.ok) {
    try {
      const file = await client.file(f.key);
      body = figmaText(file.document);
      budget.take();
    } catch (e) {
      if (e instanceof FigmaRateLimit || e instanceof FigmaAuthError) {
        // 내용은 다음에 받는다. 목록 정보는 그대로 저장
        body = "";
      } else throw e;
    }
  }
  const row = {
    sourceId: src.id,
    folderId,
    path,
    externalId: f.key,
    url: figmaFileUrl(f.key),
    title,
    ext: "figma",
    kind: "design",
    size: body.length,
    // 내용을 못 받았으면 다음에 다시 시도하도록 버전을 비워 둔다
    contentHash: body || !budget.ok ? f.last_modified : null,
    fileId: null,
    dev: null,
    state: "ok" as const,
    noContentReason: body ? null : "unsupported",
    createdAt: existing?.createdAt ?? ts(f.last_modified),
    modifiedAt: ts(f.last_modified),
    indexedAt: now,
    deletedDetectedAt: null,
    // 디자인 항목의 미리보기 = 썸네일 주소 (Figma 가 주는 임시 주소, 확인할 때마다 갱신)
    previewText: f.thumbnail_url ?? null,
    ...(jobId ? { seenScanId: jobId } : {}),
  };
  const saved = existing ? db.update(items).set(row).where(eq(items.id, existing.id)).returning().get() : db.insert(items).values(row).returning().get();
  writeItemText(db, saved.id, { title, path: cloudPathLabel(path), body });
}

type ScanResult = { jobId?: number; result: "ok" | "aborted" | "offline" | "error"; message?: string; deleted?: number };

/** 전체 확인 (변경 확인도 같은 함수: 목록 요청이 가볍고, 바뀐 파일만 내용을 받는다) */
export async function runFigmaScan(db: Db, sourceId: number, d: FigmaSyncDeps, full = true): Promise<ScanResult> {
  const src = db.select().from(sources).where(eq(sources.id, sourceId)).get();
  if (!src) return { result: "error", message: "소스 없음" };
  const cfg = (src.config ?? {}) as FigmaConfig;
  const settings = getSettings(db);
  const job = full ? db.insert(scanJobs).values({ sourceId: src.id, kind: "full", scopePath: src.rootPath, startedAt: d.now() }).returning().get() : null;
  const jobId = job?.id ?? null;
  try {
    let projects: { id: string; name: string }[];
    let rootName: string;
    let firstFiles: FgFile[] | null = null;
    if (cfg.target === "team") {
      const t = await d.client.teamProjects(cfg.id);
      rootName = t.name || `팀 ${cfg.id}`;
      projects = t.projects.map((p) => ({ id: String(p.id), name: p.name }));
    } else {
      const p = await d.client.projectFiles(cfg.id);
      rootName = p.name || `프로젝트 ${cfg.id}`;
      firstFiles = p.files;
      projects = [{ id: cfg.id, name: rootName }];
    }
    if (full) db.update(sources).set({ status: "syncing" }).where(eq(sources.id, src.id)).run();
    const rootFolder = upsertCloudFolder(db, src, `root:${cfg.target}${cfg.id}`, rootName, src.rootPath, null, jobId);
    let processed = 0;
    for (const p of projects) {
      if (d.shouldAbort?.()) {
        if (job) db.update(scanJobs).set({ result: "aborted", processed }).where(eq(scanJobs.id, job.id)).run();
        db.update(sources).set({ status: "ok" }).where(eq(sources.id, src.id)).run();
        return { jobId: job?.id, result: "aborted" };
      }
      // 프로젝트 하나만 등록했으면 루트가 곧 프로젝트
      const projectPath = cfg.target === "project" ? src.rootPath : `${src.rootPath}/${seg(p.name, `p${p.id}`)}`;
      const folderId = cfg.target === "project" ? rootFolder : upsertCloudFolder(db, src, `p${p.id}`, p.name, projectPath, null, jobId);
      const files = firstFiles ?? (await d.client.projectFiles(p.id)).files;
      for (const f of files) await processFigmaFile(db, src, d.client, f, projectPath, folderId, jobId, d.now());
      processed += files.length;
      if (job) db.update(scanJobs).set({ processed }).where(eq(scanJobs.id, job.id)).run();
    }
    const now = d.now();
    let deleted = 0;
    if (full && job) {
      purgeExcluded(db, settings);
      deleted = finalizeDeletions(db, src, src.rootPath, job.id, [], now, settings);
      db.update(scanJobs).set({ result: "ok", finishedAt: now, processed }).where(eq(scanJobs.id, job.id)).run();
      db.update(sources).set({ status: "ok", lastError: null, lastFullScanAt: now, lastFullScanOk: true }).where(eq(sources.id, src.id)).run();
    } else if (src.status !== "syncing") db.update(sources).set({ status: "ok", lastError: null }).where(eq(sources.id, src.id)).run();
    patchSourceConfig(db, src.id, { name: rootName });
    return { jobId: job?.id, result: "ok", deleted };
  } catch (e) {
    const c = classify(e);
    db.update(sources).set({ status: c.status, lastError: c.message, ...(full ? { lastFullScanOk: false } : {}) }).where(eq(sources.id, src.id)).run();
    if (job) db.update(scanJobs).set({ result: c.status === "offline" ? "aborted" : "error", message: c.message }).where(eq(scanJobs.id, job.id)).run();
    return { jobId: job?.id, result: c.status === "offline" ? "offline" : "error", message: c.message };
  }
}
