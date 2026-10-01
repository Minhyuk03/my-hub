import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { chunkText, runChunks } from "@/server/ai/chunks";
import { Ollama } from "@/server/ai/ollama";
import { hybridSearch } from "@/server/search/semantic";
import { runScan } from "@/server/sync/scanner";
import { addSource, deps, testDb, tmpDir, write } from "./helpers";

/** 가짜 임베딩: 뜻이 같은 낱말을 같은 축으로 (강아지=반려견=dog, 예산=비용) */
const GROUPS = [["강아지", "반려견", "dog"], ["예산", "비용", "budget"], ["여행", "trip"]];
function fake(down = false) {
  let calls = 0;
  const f = (async (_u: string | URL | Request, init?: RequestInit) => {
    if (down) throw new TypeError("fetch failed");
    calls++;
    const body = JSON.parse(String(init?.body));
    const embeddings = (body.input as string[]).map((t) => {
      const v: number[] = GROUPS.map((g) => (g.some((w) => t.toLowerCase().includes(w)) ? 1 : 0));
      v.push(0.01);
      while (v.length < 1024) v.push(0);
      return v;
    });
    return Response.json({ embeddings });
  }) as typeof fetch;
  return { ai: new Ollama({ fetch: f, baseUrl: "http://x" }), calls: () => calls };
}

async function setup() {
  const db = testDb();
  const root = tmpDir();
  write(root, "펫/산책.md", "반려견과 매일 아침 산책을 한다. ".repeat(10));
  write(root, "돈/가계부.md", "이번 달 비용을 정리했다. 식비와 교통비. ".repeat(10));
  write(root, "기타/강아지 사진 목록.md", "사진 파일 이름만 적어 둔 메모 ".repeat(10));
  const src = addSource(db, root);
  await runScan(db, src.id, deps());
  return { db, root, src };
}

describe("의미 검색 (Phase 4)", () => {
  it("본문을 문단 경계를 살려 겹치게 나눈다", () => {
    const body = Array.from({ length: 30 }, (_, i) => `문단 ${i} ` + "내용 ".repeat(20)).join("\n\n");
    const parts = chunkText(body, 700, 100, 60);
    expect(parts.length).toBeGreaterThan(3);
    expect(parts.every((p) => p.length <= 700)).toBe(true);
    expect(chunkText("짧은 글", 700, 100)).toEqual(["짧은 글"]);
    expect(chunkText(body, 700, 100, 2)).toHaveLength(2); // 문서당 상한
  });

  it("조각을 만들고, 낱말이 달라도 뜻이 같은 문서를 찾는다 (하이브리드)", async () => {
    const { db } = await setup();
    const { ai } = fake();
    const r = await runChunks(db, ai, "bge-m3", 1000);
    expect(r.items).toBe(3);
    const res = await hybridSearch(db, ai, "bge-m3", "강아지");
    expect(res.mode).toBe("hybrid");
    const titles = res.hits.map((h) => h.title);
    // 키워드로 찾은 '강아지 사진 목록' + 뜻으로 찾은 '산책'(반려견)
    expect(titles).toContain("강아지 사진 목록");
    expect(titles).toContain("산책");
    expect(titles).not.toContain("가계부");
    const walk = res.hits.find((h) => h.title === "산책")!;
    expect(walk.snippet).toMatch("반려견");
    // 의미 검색만
    const sem = await hybridSearch(db, ai, "bge-m3", "budget", {}, 30, 0, "semantic");
    expect(sem.hits.map((h) => h.title)).toEqual(["가계부"]);
  });

  it("바뀌지 않은 문서는 조각을 다시 만들지 않고, 바뀌면 새로 만든다. 지우면 조각도 지운다", async () => {
    const { db, root } = await setup();
    const f = fake();
    await runChunks(db, f.ai, "bge-m3", 1000);
    const n0 = f.calls();
    await runScan(db, 1, deps());
    await runChunks(db, f.ai, "bge-m3", 1000);
    expect(f.calls()).toBe(n0);
    fs.writeFileSync(path.join(root, "돈/가계부.md"), "여행 경비 정리 ".repeat(30));
    await runScan(db, 1, deps());
    await runChunks(db, f.ai, "bge-m3", 1000);
    expect((await hybridSearch(db, f.ai, "bge-m3", "trip", {}, 30, 0, "semantic")).hits.map((h) => h.title)).toEqual(["가계부"]);
    fs.rmSync(path.join(root, "돈/가계부.md"));
    await runScan(db, 1, deps());
    expect(db.$client.prepare("SELECT count(*) FROM item_chunks ch JOIN items i ON i.id = ch.item_id WHERE i.title = '가계부'").pluck().get()).toBe(0);
  });

  it("필터(소스·형식 등)는 의미 검색에도 적용된다", async () => {
    const { db } = await setup();
    const { ai } = fake();
    await runChunks(db, ai, "bge-m3", 1000);
    expect((await hybridSearch(db, ai, "bge-m3", "강아지", { kinds: ["pdf"] })).hits).toHaveLength(0);
  });

  it("임베딩 모델을 쓸 수 없으면 키워드 결과만 돌려준다", async () => {
    const { db } = await setup();
    const res = await hybridSearch(db, fake(true).ai, "bge-m3", "강아지");
    expect(res.mode).toBe("keyword");
    expect(res.semanticNote).toBeTruthy();
    expect(res.hits.map((h) => h.title)).toEqual(["강아지 사진 목록"]);
  });
});
