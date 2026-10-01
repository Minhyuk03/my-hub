/**
 * GitHub 동기화 (내가 소유한 저장소)
 * - 저장소 = 폴더 + 같은 경로의 항목(README·설명·주제·언어·최근 커밋). 프로젝트에 저장소를 연결하면 저장소와 그 이슈·PR 이 함께 들어간다.
 * - 이슈·PR = 저장소 폴더 아래 항목.
 * - 저장소·이슈는 GitHub ID 로 추적하므로 이름을 바꿔도 같은 항목·같은 연결이 유지된다.
 * - 전체 확인이 끝까지 성공했을 때만 사라진 저장소·이슈를 deleted 로 표시한다. 이슈가 너무 많아 끝까지 못 읽은 저장소는 이슈를 지우지 않는다.
 */
import { and, eq, gt, lt } from "drizzle-orm";
import type { Db } from "../../db";
import { items, scanJobs, sources } from "../../db/schema";
import { writeItemText } from "../../search/index-writer";
import { getSettings } from "../../settings";
import { finalizeDeletions, purgeExcluded, replaceTags } from "../../sync/scanner";
import { cloudPathLabel, patchSourceConfig, seg, upsertCloudFolder } from "../common";
import { GitHubAuthError, type GitHubClient, type GhIssue, type GhRepo } from "./client";

type Source = typeof sources.$inferSelect;
export type GitHubConfig = { login: string; includeForks?: boolean; lastSync?: string };
export type GitHubSyncDeps = { client: GitHubClient; now: () => number; shouldAbort?: () => boolean };

export const githubRoot = (login: string) => `github:/${login}`;
const ts = (iso?: string | null) => (iso ? Date.parse(iso) : null);

function classify(e: unknown): { status: "offline" | "error"; message: string } {
  if (e instanceof GitHubAuthError) return { status: "offline", message: e.message };
  const msg = e instanceof Error ? e.message : String(e);
  if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|network|요청 한도/i.test(msg)) return { status: "offline", message: /한도/.test(msg) ? msg : "네트워크에 연결할 수 없습니다." };
  return { status: "error", message: msg };
}

function upsertItem(db: Db, src: Source, externalId: string, row: Omit<typeof items.$inferInsert, "sourceId" | "externalId">, body: string, tagList: string[] | null) {
  const existing = db.select().from(items).where(and(eq(items.sourceId, src.id), eq(items.externalId, externalId))).get() ?? db.select().from(items).where(eq(items.path, row.path!)).get();
  const full = { ...row, sourceId: src.id, externalId };
  const saved = existing ? db.update(items).set(full).where(eq(items.id, existing.id)).returning().get() : db.insert(items).values(full).returning().get();
  writeItemText(db, saved.id, { title: saved.title, path: cloudPathLabel(saved.path), body });
  if (tagList) replaceTags(db, saved.id, tagList);
  return saved;
}

/** 내용이 그대로면 경로·제목만 맞춘다 */
function keepIfSame(db: Db, src: Source, externalId: string, version: string, path: string, title: string, folderId: number | null, jobId: number | null): boolean {
  const ex = db.select().from(items).where(and(eq(items.sourceId, src.id), eq(items.externalId, externalId))).get();
  if (!ex || ex.state === "deleted" || ex.contentHash !== version) return false;
  if (ex.path !== path || ex.title !== title || ex.folderId !== folderId) {
    db.update(items).set({ path, title, folderId }).where(eq(items.id, ex.id)).run();
    const body = (db.$client.prepare(`SELECT body FROM item_text WHERE item_id = ?`).pluck().get(ex.id) as string | undefined) ?? "";
    writeItemText(db, ex.id, { title, path: cloudPathLabel(path), body });
  }
  if (jobId) db.update(items).set({ seenScanId: jobId }).where(eq(items.id, ex.id)).run();
  return true;
}

export async function processRepo(db: Db, src: Source, client: GitHubClient, repo: GhRepo, rootPath: string, jobId: number | null, now: number) {
  const path = `${rootPath}/${seg(repo.name, `r${repo.id}`)}`;
  const modified = Math.max(ts(repo.pushed_at) ?? 0, ts(repo.updated_at) ?? 0) || null;
  const folderId = upsertCloudFolder(db, src, `r${repo.id}`, repo.name, path, modified, jobId);
  const version = `${repo.pushed_at}|${repo.updated_at}`;
  if (keepIfSame(db, src, `r${repo.id}`, version, path, repo.name, folderId, jobId)) return { path, folderId };
  const [readme, commits] = await Promise.all([client.readme(repo.full_name), client.commits(repo.full_name)]);
  const body = [
    repo.description ?? "",
    repo.topics?.length ? `주제: ${repo.topics.join(", ")}` : "",
    repo.language ? `언어: ${repo.language}` : "",
    `${repo.private ? "비공개" : "공개"} 저장소${repo.archived ? " · 보관됨" : ""}`,
    readme,
    commits.length ? "## 최근 커밋\n" + commits.map((c) => `- ${c.commit.author?.date?.slice(0, 10) ?? ""} ${c.commit.message.split("\n")[0]}`).join("\n") : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  upsertItem(
    db,
    src,
    `r${repo.id}`,
    {
      folderId,
      path,
      url: repo.html_url,
      title: repo.name,
      ext: "repo",
      kind: "document",
      size: body.length,
      contentHash: version,
      state: "ok",
      noContentReason: null,
      createdAt: ts(repo.created_at),
      modifiedAt: modified,
      indexedAt: now,
      deletedDetectedAt: null,
      previewText: body.slice(0, 300) || null,
      ...(jobId ? { seenScanId: jobId } : {}),
    },
    body,
    (repo.topics ?? []).map((t) => t.normalize("NFC")),
  );
  return { path, folderId };
}

export function processIssue(db: Db, src: Source, issue: GhIssue, repoPath: string, folderId: number, jobId: number | null, now: number) {
  const kind = issue.pull_request ? "PR" : "이슈";
  const title = `${kind} #${issue.number} ${issue.title}`.normalize("NFC");
  const path = `${repoPath}/${seg(title, `i${issue.id}`)}`;
  if (keepIfSame(db, src, `i${issue.id}`, issue.updated_at, path, title, folderId, jobId)) return;
  const labels = issue.labels.map((l) => (typeof l === "string" ? l : l.name));
  const body = [`${issue.state === "open" ? "열림" : "닫힘"}${labels.length ? ` · 라벨: ${labels.join(", ")}` : ""}${issue.user ? ` · 작성: ${issue.user.login}` : ""}`, issue.body ?? ""].join("\n\n");
  upsertItem(
    db,
    src,
    `i${issue.id}`,
    {
      folderId,
      path,
      url: issue.html_url,
      title,
      ext: issue.pull_request ? "pr" : "issue",
      kind: "document",
      size: body.length,
      contentHash: issue.updated_at,
      state: "ok",
      noContentReason: null,
      createdAt: ts(issue.created_at),
      modifiedAt: ts(issue.updated_at),
      indexedAt: now,
      deletedDetectedAt: null,
      previewText: body.slice(0, 300) || null,
      ...(jobId ? { seenScanId: jobId } : {}),
    },
    body,
    null,
  );
}

const ownRepos = (repos: GhRepo[], cfg: GitHubConfig) => repos.filter((r) => r.owner.login.toLowerCase() === cfg.login.toLowerCase() && (cfg.includeForks || !r.fork));

type ScanResult = { jobId?: number; result: "ok" | "aborted" | "offline" | "error"; message?: string; deleted?: number };

export async function runGitHubScan(db: Db, sourceId: number, d: GitHubSyncDeps): Promise<ScanResult> {
  const src = db.select().from(sources).where(eq(sources.id, sourceId)).get();
  if (!src) return { result: "error", message: "소스 없음" };
  const cfg = (src.config ?? {}) as GitHubConfig;
  const settings = getSettings(db);
  const started = new Date(d.now()).toISOString();
  const job = db.insert(scanJobs).values({ sourceId: src.id, kind: "full", scopePath: src.rootPath, startedAt: d.now() }).returning().get();
  try {
    const me = await d.client.me();
    if (me.login.toLowerCase() !== cfg.login.toLowerCase()) throw new GitHubAuthError(`토큰의 계정(${me.login})이 등록한 계정(${cfg.login})과 다릅니다.`);
    db.update(sources).set({ status: "syncing" }).where(eq(sources.id, src.id)).run();
    upsertCloudFolder(db, src, `root:${cfg.login}`, cfg.login, src.rootPath, null, job.id);
    const repos = ownRepos((await d.client.repos()).items, cfg);
    let processed = 0;
    for (const repo of repos) {
      if (d.shouldAbort?.()) {
        db.update(scanJobs).set({ result: "aborted", processed }).where(eq(scanJobs.id, job.id)).run();
        db.update(sources).set({ status: "ok" }).where(eq(sources.id, src.id)).run();
        return { jobId: job.id, result: "aborted" };
      }
      const { path, folderId } = await processRepo(db, src, d.client, repo, src.rootPath, job.id, d.now());
      const iss = await d.client.issues(repo.full_name);
      for (const i of iss.items) processIssue(db, src, i, path, folderId, job.id, d.now());
      if (iss.capped) {
        // 이슈가 너무 많아 끝까지 못 읽었으면 이 저장소의 기존 이슈는 지우지 않는다
        db.update(items).set({ seenScanId: job.id }).where(and(eq(items.sourceId, src.id), gt(items.path, path + "/"), lt(items.path, path + "0"))).run();
      }
      processed += 1 + iss.items.length;
      db.update(scanJobs).set({ processed }).where(eq(scanJobs.id, job.id)).run();
    }
    purgeExcluded(db, settings);
    const deleted = finalizeDeletions(db, src, src.rootPath, job.id, [], d.now(), settings);
    const now = d.now();
    db.update(scanJobs).set({ result: "ok", finishedAt: now, processed }).where(eq(scanJobs.id, job.id)).run();
    patchSourceConfig(db, src.id, { lastSync: started });
    db.update(sources).set({ status: "ok", lastError: null, lastFullScanAt: now, lastFullScanOk: true }).where(eq(sources.id, src.id)).run();
    return { jobId: job.id, result: "ok", deleted };
  } catch (e) {
    const c = classify(e);
    db.update(sources).set({ status: c.status, lastError: c.message, lastFullScanOk: false }).where(eq(sources.id, src.id)).run();
    db.update(scanJobs).set({ result: c.status === "offline" ? "aborted" : "error", message: c.message }).where(eq(scanJobs.id, job.id)).run();
    return { jobId: job.id, result: c.status === "offline" ? "offline" : "error", message: c.message };
  }
}

/** 바뀐 저장소와 마지막 동기화 뒤 바뀐 이슈만 반영 (삭제 판단은 전체 확인에서) */
export async function runGitHubChanges(db: Db, sourceId: number, d: GitHubSyncDeps): Promise<{ result: "ok" | "offline" | "error" | "skipped"; changed?: number; message?: string }> {
  const src = db.select().from(sources).where(eq(sources.id, sourceId)).get();
  if (!src) return { result: "error", message: "소스 없음" };
  const cfg = (src.config ?? {}) as GitHubConfig;
  if (!cfg.lastSync) return { result: "skipped" };
  const started = new Date(d.now()).toISOString();
  try {
    let changed = 0;
    for (const repo of ownRepos((await d.client.repos()).items, cfg)) {
      const before = db.select({ h: items.contentHash }).from(items).where(and(eq(items.sourceId, src.id), eq(items.externalId, `r${repo.id}`))).get()?.h;
      const { path, folderId } = await processRepo(db, src, d.client, repo, src.rootPath, null, d.now());
      if (before !== `${repo.pushed_at}|${repo.updated_at}`) changed++;
      const iss = await d.client.issues(repo.full_name, cfg.lastSync, 2);
      for (const i of iss.items) processIssue(db, src, i, path, folderId, null, d.now());
      changed += iss.items.length;
    }
    patchSourceConfig(db, src.id, { lastSync: started });
    if (src.status !== "syncing") db.update(sources).set({ status: "ok", lastError: null }).where(eq(sources.id, src.id)).run();
    return { result: "ok", changed };
  } catch (e) {
    const c = classify(e);
    db.update(sources).set({ status: c.status, lastError: c.message }).where(eq(sources.id, src.id)).run();
    return { result: c.status, message: c.message };
  }
}
