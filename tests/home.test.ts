import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { bookmarks, folders } from "@/server/db/schema";
import { addBookmark, addGroup, addTile, bookmarkBar, importChromeBar, move, parseChromeBookmarks, safeUrl, tiles } from "@/server/home";
import { runScan } from "@/server/sync/scanner";
import { addSource, deps, testDb, tmpDir, write } from "./helpers";

describe("홈: 북마크·즐겨찾기", () => {
  it("주소 검사: 위험한 주소 거부, 도메인만 쓰면 https", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,x")).toBeNull();
    expect(safeUrl("file:///etc/passwd")).toBeNull();
    expect(safeUrl("youtube.com")).toBe("https://youtube.com/");
    expect(safeUrl("obsidian://open?vault=Documents")).toMatch(/^obsidian:/);
  });

  it("북마크 폴더와 순서 바꾸기", () => {
    const db = testDb();
    const g = addGroup(db, "AI");
    const a = addBookmark(db, g.id, "A", "https://a.com");
    addBookmark(db, g.id, "B", "https://b.com");
    addBookmark(db, null, "Root", "https://r.com");
    move(db, bookmarks, a.id, 1);
    const bar = bookmarkBar(db);
    expect(bar.groups[0].items.map((b) => b.title)).toEqual(["B", "A"]);
    expect(bar.root.map((b) => b.title)).toEqual(["Root"]);
    expect(() => addBookmark(db, null, "x", "javascript:alert(1)")).toThrow();
  });

  it("Chrome 북마크 바 가져오기: 폴더 유지, 하위 폴더 펼침, 중복 제외", () => {
    const db = testDb();
    const json = JSON.stringify({
      roots: {
        bookmark_bar: {
          children: [
            { type: "folder", name: "KMOU", children: [{ type: "url", name: "학교", url: "https://kmou.ac.kr" }, { type: "folder", name: "과제", children: [{ type: "url", name: "LMS", url: "https://lms.kmou.ac.kr" }] }] },
            { type: "url", name: "YouTube", url: "https://youtube.com" },
            { type: "url", name: "나쁜", url: "javascript:alert(1)" },
          ],
        },
      },
    });
    const bar = parseChromeBookmarks(json);
    expect(bar.groups[0].items.map((i) => i.title)).toEqual(["학교", "LMS"]);
    expect(importChromeBar(db, bar)).toBe(3);
    expect(importChromeBar(db, bar)).toBe(0); // 다시 가져와도 중복 없음
    expect(bookmarkBar(db).groups.map((g) => g.name)).toEqual(["KMOU"]);
  });

  it("즐겨찾기 타일: 폴더·웹 주소, 폴더가 사라지면 경고", async () => {
    const db = testDb();
    const root = tmpDir();
    write(root, "블로그/a.md");
    const src = addSource(db, root);
    await runScan(db, src.id, deps());
    const f = db.select().from(folders).where(eq(folders.path, path.join(root, "블로그"))).get()!;
    addTile(db, "folder", String(f.id));
    addTile(db, "url", "github.com", "깃허브");
    const t = tiles(db);
    expect(t.map((x) => [x.kind, x.title, x.href])).toEqual([
      ["folder", "블로그", `/folders/${f.id}`],
      ["url", "깃허브", "https://github.com/"],
    ]);
    db.update(folders).set({ state: "deleted" }).where(eq(folders.id, f.id)).run();
    expect(tiles(db)[0].warning).toBe("폴더 없음");
    expect(() => addTile(db, "url", "javascript:x")).toThrow();
  });
});

describe("북마크 HTML 가져오기", () => {
  it("북마크 바 폴더만 읽고, 하위 폴더는 펼친다", async () => {
    const { parseBookmarkHtml } = await import("@/server/home");
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
<DT><H3 ADD_DATE="1" PERSONAL_TOOLBAR_FOLDER="true">북마크바</H3>
<DL><p>
  <DT><H3>KMOU</H3>
  <DL><p>
    <DT><A HREF="https://kmou.ac.kr" ADD_DATE="1">학교 &amp; 학과</A>
    <DT><H3>과제</H3>
    <DL><p><DT><A HREF="https://lms.kmou.ac.kr">LMS</A></DL><p>
  </DL><p>
  <DT><A HREF="https://youtube.com">Youtube</A>
</DL><p>
<DT><H3>기타 북마크</H3>
<DL><p><DT><A HREF="https://other.com">Other</A></DL><p>
</DL><p>`;
    const bar = parseBookmarkHtml(html);
    expect(bar.groups).toEqual([{ name: "KMOU", items: [{ title: "학교 & 학과", url: "https://kmou.ac.kr" }, { title: "LMS", url: "https://lms.kmou.ac.kr" }] }]);
    expect(bar.root).toEqual([{ title: "Youtube", url: "https://youtube.com" }]);
  });
});
