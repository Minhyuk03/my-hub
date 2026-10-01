import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DriveClient, FOLDER_MIME, type DriveFile } from "@/server/connectors/gdrive/client";
import { driveRoot, drivePathLabel, runDriveChanges, runDriveScan } from "@/server/connectors/gdrive/sync";
import { memoryStore } from "@/server/connectors/gdrive/tokens";
import { folders, items, sources } from "@/server/db/schema";
import { createProject, linkFolder, projectItemList } from "@/server/projects";
import { computeSuggestions } from "@/server/projects/suggest";
import { search } from "@/server/search/query";
import { runScan } from "@/server/sync/scanner";
import { addSource, deps, testDb, tmpDir, write } from "./helpers";

const DOC = "application/vnd.google-apps.document";

/** 가짜 Google Drive (테스트용). fetch 로 들어온 요청에 Drive API 처럼 답한다. */
class FakeDrive {
  files = new Map<string, DriveFile & { content?: string }>();
  changeLog: { seq: number; fileId: string; removed?: boolean }[] = [];
  seq = 1;
  pageSize = 2;
  revoked = false;
  rateLimitOnce = 0;
  calls: string[] = [];
  private n = 0;
  constructor() {
    this.files.set("ROOT", { id: "ROOT", name: "블로그 리뉴얼", mimeType: FOLDER_MIME, parents: ["MYDRIVE"], modifiedTime: "2026-09-01T00:00:00Z" });
  }
  add(f: Partial<DriveFile> & { name: string; parent: string; content?: string; mimeType?: string }) {
    const id = `F${++this.n}`;
    const file = { id, name: f.name, mimeType: f.mimeType ?? "text/plain", parents: [f.parent], modifiedTime: new Date(Date.UTC(2026, 8, 1, 0, this.n)).toISOString(), size: String(f.content?.length ?? 0), content: f.content, webViewLink: `https://drive.google.com/file/d/${id}/view` };
    this.files.set(id, file);
    this.log(id);
    return id;
  }
  update(id: string, patch: Partial<DriveFile & { content: string }>) {
    const f = this.files.get(id)!;
    Object.assign(f, patch, { modifiedTime: new Date(Date.parse(f.modifiedTime!) + 60_000).toISOString() });
    this.log(id);
  }
  remove(id: string) {
    this.files.delete(id);
    this.changeLog.push({ seq: this.seq++, fileId: id, removed: true });
  }
  private log(id: string) {
    this.changeLog.push({ seq: this.seq++, fileId: id });
  }
  private json(o: unknown, status = 200) {
    return new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
  }
  meta(f: DriveFile & { content?: string }): DriveFile {
    const { content, ...m } = f;
    void content;
    return m;
  }
  fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input));
    this.calls.push(u.pathname + (u.searchParams.get("alt") ? "?alt=media" : ""));
    if (u.hostname === "oauth2.googleapis.com") return this.revoked ? this.json({ error: "invalid_grant" }, 400) : this.json({ access_token: "AT", expires_in: 3600 });
    if (this.rateLimitOnce > 0) {
      this.rateLimitOnce--;
      return this.json({ error: { message: "rateLimitExceeded" } }, 429);
    }
    void init;
    const p = u.pathname.replace("/drive/v3", "");
    if (p === "/changes/startPageToken") return this.json({ startPageToken: String(this.seq) });
    if (p === "/changes") {
      const from = Number(u.searchParams.get("pageToken"));
      const list = this.changeLog.filter((c) => c.seq >= from);
      return this.json({
        changes: list.map((c) => ({ fileId: c.fileId, removed: c.removed, file: c.removed ? undefined : this.meta(this.files.get(c.fileId)!) })),
        newStartPageToken: String(this.seq),
      });
    }
    if (p === "/files") {
      const parent = u.searchParams.get("q")!.match(/'([^']+)' in parents/)![1];
      const all = [...this.files.values()].filter((f) => f.parents?.includes(parent) && !f.trashed);
      const start = Number(u.searchParams.get("pageToken") ?? 0);
      const page = all.slice(start, start + this.pageSize);
      return this.json({ files: page.map((f) => this.meta(f)), nextPageToken: start + this.pageSize < all.length ? String(start + this.pageSize) : undefined });
    }
    const m = p.match(/^\/files\/([^/]+)(\/export)?$/);
    if (m) {
      const f = this.files.get(decodeURIComponent(m[1]));
      if (!f) return this.json({ error: "notFound" }, 404);
      if (m[2] || u.searchParams.get("alt") === "media") return new Response(f.content ?? "");
      return this.json(this.meta(f));
    }
    return this.json({ error: "unknown" }, 400);
  }) as typeof fetch;
}

function setup() {
  const db = testDb();
  const fake = new FakeDrive();
  const client = new DriveClient({ fetch: fake.fetch, tokens: memoryStore("RT"), clientId: "id", clientSecret: "secret", sleep: async () => {} });
  const src = db
    .insert(sources)
    .values({ kind: "gdrive", name: "블로그 리뉴얼 (Google Drive)", rootPath: driveRoot("ROOT"), config: { folderId: "ROOT" }, createdAt: Date.now() })
    .returning()
    .get();
  const d = { client, now: () => Date.now() };
  return { db, fake, client, src, d };
}

const titles = (db: ReturnType<typeof testDb>) =>
  db
    .select()
    .from(items)
    .all()
    .filter((i) => i.state !== "deleted")
    .map((i) => i.title)
    .sort();

describe("Google Drive 연결 (Phase 3a)", () => {
  it("전체 확인: 폴더·파일을 가져오고 Google 문서는 텍스트로 색인, 원본 주소 저장 (여러 페이지)", async () => {
    const { db, fake, src, d } = setup();
    const sub = fake.add({ name: "기획", parent: "ROOT", mimeType: FOLDER_MIME });
    fake.add({ name: "기획서", parent: sub, mimeType: DOC, content: "블로그 개편 일정과 목표" });
    fake.add({ name: "메모.txt", parent: "ROOT", content: "드라이브 메모" });
    fake.add({ name: "사진.png", parent: "ROOT", mimeType: "image/png", content: "png" });
    const r = await runDriveScan(db, src.id, d);
    expect(r.result).toBe("ok");
    expect(titles(db)).toEqual(["기획서", "메모.txt", "사진.png"]);
    const hit = search(db, "개편").hits[0];
    expect(hit.title).toBe("기획서");
    const it = db.select().from(items).where(eq(items.title, "기획서")).get()!;
    expect(it.url).toMatch(/^https:\/\/drive\.google\.com\//);
    expect(drivePathLabel(it.path)).toBe("Google Drive/기획/기획서");
    expect(fake.calls.filter((c) => c.endsWith("/export"))).toHaveLength(1);
    // 이미지는 내용을 받지 않는다
    expect(fake.calls.some((c) => c.includes("?alt=media") && c.includes("F4"))).toBe(false);
  });

  it("숨김 파일(.DS_Store)·제외 이름은 가져오지 않는다", async () => {
    const { db, fake, src, d } = setup();
    fake.add({ name: ".DS_Store", parent: "ROOT", content: "x" });
    fake.add({ name: "node_modules", parent: "ROOT", mimeType: FOLDER_MIME });
    fake.add({ name: "보고서.txt", parent: "ROOT", content: "x" });
    await runDriveScan(db, src.id, d);
    expect(titles(db)).toEqual(["보고서.txt"]);
    expect(db.select().from(folders).all().map((f) => f.name)).not.toContain("node_modules");
  });

  it("바뀌지 않은 파일은 다시 받지 않는다", async () => {
    const { db, fake, src, d } = setup();
    fake.add({ name: "메모.txt", parent: "ROOT", content: "x" });
    await runDriveScan(db, src.id, d);
    const before = fake.calls.length;
    await runDriveScan(db, src.id, d);
    expect(fake.calls.slice(before).some((c) => c.includes("alt=media"))).toBe(false);
  });

  it("변경 반영: 새 파일, 수정, 이름 변경·이동(같은 항목 유지), 삭제", async () => {
    const { db, fake, src, d } = setup();
    const a = fake.add({ name: "A", parent: "ROOT", mimeType: FOLDER_MIME });
    const b = fake.add({ name: "B", parent: "ROOT", mimeType: FOLDER_MIME });
    const doc = fake.add({ name: "노트.txt", parent: a, content: "처음 내용" });
    await runDriveScan(db, src.id, d);
    const id0 = db.select().from(items).where(eq(items.externalId, doc)).get()!.id;

    fake.add({ name: "새 파일.txt", parent: b, content: "새로 생김" });
    fake.update(doc, { content: "바뀐 내용" });
    fake.update(a, { name: "A-이름변경" });
    let r = await runDriveChanges(db, src.id, d);
    expect(r.result).toBe("ok");
    expect(search(db, "바뀐").hits).toHaveLength(1);
    expect(search(db, "새로").hits).toHaveLength(1);
    const moved = db.select().from(items).where(eq(items.externalId, doc)).get()!;
    expect(moved.id).toBe(id0);
    expect(drivePathLabel(moved.path)).toBe("Google Drive/A-이름변경/노트.txt");

    fake.update(doc, { parents: [b] });
    await runDriveChanges(db, src.id, d);
    expect(drivePathLabel(db.select().from(items).where(eq(items.externalId, doc)).get()!.path)).toBe("Google Drive/B/노트.txt");

    fake.remove(doc);
    r = await runDriveChanges(db, src.id, d);
    expect(db.select().from(items).where(eq(items.externalId, doc)).get()!.state).toBe("deleted");
    expect(search(db, "바뀐").hits).toHaveLength(0);
  });

  it("범위 밖으로 옮긴 파일은 빠지고, 범위 안으로 옮겨 온 폴더는 안의 내용까지 가져온다", async () => {
    const { db, fake, src, d } = setup();
    fake.files.set("OUT", { id: "OUT", name: "바깥", mimeType: FOLDER_MIME, parents: ["MYDRIVE"] });
    const doc = fake.add({ name: "안.txt", parent: "ROOT", content: "안쪽" });
    const outFolder = fake.add({ name: "가져올 폴더", parent: "OUT", mimeType: FOLDER_MIME });
    fake.add({ name: "속.txt", parent: outFolder, content: "속 내용" });
    await runDriveScan(db, src.id, d);
    fake.update(doc, { parents: ["OUT"] });
    fake.update(outFolder, { parents: ["ROOT"] });
    await runDriveChanges(db, src.id, d);
    expect(titles(db)).toEqual(["속.txt"]);
  });

  it("폴더 이름이 바뀌어도 프로젝트 연결이 유지되고, 로컬 폴더와 함께 한 목록에 보인다", async () => {
    const { db, fake, src, d } = setup();
    const f = fake.add({ name: "기획", parent: "ROOT", mimeType: FOLDER_MIME });
    fake.add({ name: "기획서", parent: f, mimeType: DOC, content: "드라이브 기획서" });
    await runDriveScan(db, src.id, d);
    const local = tmpDir();
    write(local, "blog/index.ts", "export {}");
    const ls = addSource(db, local, { kind: "icloud" });
    await runScan(db, ls.id, deps());

    const p = createProject(db, "블로그 리뉴얼");
    linkFolder(db, p.id, db.select().from(folders).where(eq(folders.externalId, f)).get()!.id);
    linkFolder(db, p.id, db.select().from(folders).where(eq(folders.path, path.join(local, "blog"))).get()!.id);
    expect(projectItemList(db, p.id).items.map((i) => i.title).sort()).toEqual(["index.ts", "기획서"]);

    fake.update(f, { name: "기획 2026" });
    await runDriveChanges(db, src.id, d);
    expect(projectItemList(db, p.id).items.map((i) => i.title).sort()).toEqual(["index.ts", "기획서"]);
  });

  it("연결 제안에 Drive 폴더도 포함된다", async () => {
    const { db, fake, src, d } = setup();
    fake.add({ name: "Datory Lab", parent: "ROOT", mimeType: FOLDER_MIME });
    await runDriveScan(db, src.id, d);
    const local = tmpDir();
    write(local, "DatoryLab/a.md");
    const ls = addSource(db, local);
    await runScan(db, ls.id, deps());
    expect(computeSuggestions(db).some((s) => s.reason.includes("Datory Lab") && s.reason.includes("DatoryLab"))).toBe(true);
  });

  it("연결이 만료되면 오프라인으로 표시하고 아무것도 지우지 않는다", async () => {
    const { db, fake, src, d } = setup();
    fake.add({ name: "메모.txt", parent: "ROOT", content: "x" });
    await runDriveScan(db, src.id, d);
    fake.revoked = true;
    const fresh = new DriveClient({ fetch: fake.fetch, tokens: memoryStore("RT"), clientId: "id", clientSecret: "s", sleep: async () => {} });
    const r = await runDriveScan(db, src.id, { client: fresh, now: Date.now });
    expect(r.result).toBe("offline");
    expect(db.select().from(sources).get()!.status).toBe("offline");
    expect(titles(db)).toEqual(["메모.txt"]);
    expect((await runDriveChanges(db, src.id, { client: fresh, now: Date.now })).result).toBe("offline");
  });

  it("요청 제한(429)은 기다렸다가 다시 시도한다", async () => {
    const { db, fake, src, d } = setup();
    fake.add({ name: "메모.txt", parent: "ROOT", content: "x" });
    fake.rateLimitOnce = 2;
    expect((await runDriveScan(db, src.id, d)).result).toBe("ok");
    expect(titles(db)).toEqual(["메모.txt"]);
  });

  it("중간에 멈춰도 이어서 하고, 끝까지 확인한 뒤에만 삭제를 판단한다", async () => {
    const { db, fake, src, d } = setup();
    const folderIds = [1, 2, 3].map((i) => fake.add({ name: `폴더${i}`, parent: "ROOT", mimeType: FOLDER_MIME }));
    const files = folderIds.map((f, i) => fake.add({ name: `파일${i}.txt`, parent: f, content: `${i}` }));
    await runDriveScan(db, src.id, d);
    fake.files.delete(files[0]);
    let n = 0;
    const r1 = await runDriveScan(db, src.id, { ...d, shouldAbort: () => ++n > 2 });
    expect(r1.result).toBe("aborted");
    expect(titles(db)).toHaveLength(3);
    const r2 = await runDriveScan(db, src.id, d);
    expect(r2.jobId).toBe(r1.jobId);
    expect(titles(db)).toEqual(["파일1.txt", "파일2.txt"]);
  });
});

describe("테스트 중인 Google 앱의 7일 만료 알림", () => {
  it("남은 날과 만료 임박·만료를 계산한다", async () => {
    const { driveExpiry } = await import("@/server/connectors/gdrive/client");
    const t0 = Date.UTC(2026, 9, 1);
    expect(driveExpiry({ connectedAt: t0 }, true, t0 + 86400_000)).toMatchObject({ leftDays: 6, soon: false, expired: false });
    expect(driveExpiry({ connectedAt: t0 }, true, t0 + 6.5 * 86400_000)).toMatchObject({ soon: true, expired: false });
    expect(driveExpiry({ connectedAt: t0 }, true, t0 + 8 * 86400_000)).toMatchObject({ expired: true, leftDays: 0 });
    expect(driveExpiry({ connectedAt: t0 }, false)).toBeNull();
  });
});
