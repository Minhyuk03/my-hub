import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { chatCitations, chatMessages, chatThreads, folders, projectFolders, shortcuts } from "@/server/db/schema";
import { createProject, linkFolder } from "@/server/projects";
import { search } from "@/server/search/query";
import { hideSensitive, unhideSensitive } from "@/server/sensitive";
import { getSettings } from "@/server/settings";
import { runScan, SENSITIVE_ANSWER } from "@/server/sync/scanner";
import { addSource, allItems, deps, itemByPath, testDb, tmpDir, write } from "./helpers";

async function setup() {
  const db = testDb();
  const root = tmpDir("sens-");
  write(root, "개인/주민등록.md", "주민번호 메모");
  write(root, "개인/하위/통장.md", "계좌 메모");
  write(root, "업무/회의.md", "회의 메모");
  write(root, "업무/연봉.md", "연봉 메모");
  const src = addSource(db, root);
  await runScan(db, src.id, deps());
  return { db, root, src };
}

const folderId = (db: ReturnType<typeof testDb>, p: string) => db.select().from(folders).where(eq(folders.path, p)).get()?.id;

describe("민감 정보로 숨기기", () => {
  it("폴더를 숨기면 하위 전체가 색인·검색에서 빠지고, 다시 스캔해도 돌아오지 않는다 (실제 파일은 그대로)", async () => {
    const { db, root, src } = await setup();
    const id = folderId(db, path.join(root, "개인"))!;
    const r = hideSensitive(db, { kind: "folder", id });
    expect(r.ok && r.removed).toBe(2);
    expect(getSettings(db).sensitivePaths).toEqual([path.join(root, "개인")]);
    expect(search(db, "메모").hits.map((h) => h.title).sort()).toEqual(["연봉", "회의"]);
    expect(folderId(db, path.join(root, "개인"))).toBeUndefined();
    expect(folderId(db, path.join(root, "개인/하위"))).toBeUndefined();
    await runScan(db, src.id, deps());
    expect(allItems(db).map((i) => i.title).sort()).toEqual(["연봉", "회의"]);
    // 숨긴 뒤 돌아갈 곳: 상위 폴더(소스 맨 위)
    expect(r.ok && r.parentFolderId).toBe(folderId(db, root));
  });

  it("파일 하나만 숨길 수 있고, 같은 폴더의 다른 파일은 그대로 보인다", async () => {
    const { db, root } = await setup();
    const it = itemByPath(db, path.join(root, "업무/연봉.md"))!;
    expect(hideSensitive(db, { kind: "item", id: it.id }).ok).toBe(true);
    expect(search(db, "메모").hits.map((h) => h.title).sort()).toEqual(["주민등록", "통장", "회의"]);
  });

  it("숨긴 자료를 인용한 AI 답변은 지우고, 프로젝트 연결·즐겨찾기도 지운다", async () => {
    const { db, root } = await setup();
    const it = itemByPath(db, path.join(root, "개인/주민등록.md"))!;
    const other = itemByPath(db, path.join(root, "업무/회의.md"))!;
    const fid = folderId(db, path.join(root, "개인"))!;
    const now = Date.now();
    const th = db.insert(chatThreads).values({ title: "t", scope: { kind: "all" }, createdAt: now, updatedAt: now }).returning().get();
    const ans = (content: string) => db.insert(chatMessages).values({ threadId: th.id, role: "assistant", content, createdAt: now }).returning().get();
    const bad = ans("주민번호는 900101-1234567 입니다 [1]");
    const good = ans("회의는 월요일 [1]");
    db.insert(chatCitations).values({ messageId: bad.id, n: 1, itemId: it.id, title: "주민등록", path: it.path, quote: "주민번호 메모", cited: true }).run();
    db.insert(chatCitations).values({ messageId: good.id, n: 1, itemId: other.id, title: "회의", path: other.path, quote: "회의 메모", cited: true }).run();
    const p = createProject(db, "개인 일");
    linkFolder(db, p.id, fid);
    db.insert(shortcuts).values({ kind: "folder", target: String(fid), title: "개인" }).run();

    hideSensitive(db, { kind: "folder", id: fid });

    const msgs = db.select().from(chatMessages).all();
    expect(msgs.find((m) => m.id === bad.id)!.content).toBe(SENSITIVE_ANSWER);
    expect(msgs.find((m) => m.id === good.id)!.content).toBe("회의는 월요일 [1]");
    expect(db.select().from(chatCitations).all().map((c) => c.itemId)).toEqual([other.id]);
    expect(db.select().from(projectFolders).all()).toHaveLength(0);
    expect(db.select().from(shortcuts).all()).toHaveLength(0);
  });

  it("소스 맨 위 폴더는 숨기지 않는다", async () => {
    const { db, root } = await setup();
    const r = hideSensitive(db, { kind: "folder", id: folderId(db, root)! });
    expect(r.ok).toBe(false);
    expect(allItems(db)).toHaveLength(4);
  });

  it("다시 보이게 하면 다음 스캔에서 돌아온다 (NFD 경로도 같은 곳으로 본다)", async () => {
    const { db, root, src } = await setup();
    hideSensitive(db, { kind: "folder", id: folderId(db, path.join(root, "개인"))! });
    expect(unhideSensitive(db, path.join(root, "개인").normalize("NFD"))).toBe(true);
    expect(getSettings(db).sensitivePaths).toEqual([]);
    await runScan(db, src.id, deps());
    expect(allItems(db)).toHaveLength(4);
  });
});
