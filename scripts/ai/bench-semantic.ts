/**
 * Phase 4 의미 검색 측정 (16GB Mac mini)
 *   npx tsx scripts/ai/bench-semantic.ts
 * 1) sqlite-vec 검색 속도: 1024차원 벡터 3만·10만 개에서 가까운 300개 찾기 p50/p95
 * 2) 검색어 임베딩 속도 (bge-m3, 모델이 올라가 있을 때)
 * 3) 실제 허브 DB 하이브리드 검색 속도 (지금까지 만든 조각으로)
 * 4) Ollama 메모리
 * 결과: docs/phase4-semantic.md
 */
import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import * as sqliteVec from "sqlite-vec";
import { Ollama, realOllama } from "@/server/ai/ollama";
import { openDb } from "@/server/db";
import { hybridSearch } from "@/server/search/semantic";

const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];
const rss = () => {
  let kb = 0;
  for (const l of execFileSync("/bin/ps", ["-axo", "rss,comm"], { encoding: "utf8" }).split("\n")) if (/ollama/i.test(l)) kb += parseInt(l.trim()) || 0;
  return (kb / 1048576).toFixed(2);
};
function randVec(dim = 1024) {
  const v = new Float32Array(dim);
  let n = 0;
  for (let i = 0; i < dim; i++) {
    v[i] = Math.random() - 0.5;
    n += v[i] * v[i];
  }
  n = Math.sqrt(n);
  for (let i = 0; i < dim; i++) v[i] /= n;
  return v;
}

async function main() {
  const lines: string[] = ["# Phase 4 의미 검색 측정", "", `- 측정: ${new Date().toLocaleString("ko-KR")} / ${os.cpus()[0].model} / RAM ${Math.round(os.totalmem() / 1073741824)}GB / sqlite-vec`, ""];

  // 1) 벡터 검색 속도
  lines.push("## 벡터 검색 (sqlite-vec, 1024차원, 가까운 300개)", "", "| 조각 수 | 넣기 | 검색 p50 | 검색 p95 | DB 크기 |", "|---|---|---|---|---|");
  for (const n of [30_000, 100_000]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vec-"));
    const db = new Database(path.join(dir, "v.db"));
    sqliteVec.load(db);
    db.exec(`CREATE VIRTUAL TABLE v USING vec0(id INTEGER PRIMARY KEY, e float[1024] distance_metric=cosine)`);
    const ins = db.prepare(`INSERT INTO v(id, e) VALUES (?, ?)`);
    const t0 = performance.now();
    db.transaction(() => {
      for (let i = 1; i <= n; i++) ins.run(BigInt(i), randVec());
    })();
    const insMs = performance.now() - t0;
    const q = db.prepare(`SELECT id, distance FROM v WHERE e MATCH ? AND k = 300`);
    const ts: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t = performance.now();
      q.all(randVec());
      ts.push(performance.now() - t);
    }
    const size = fs.statSync(path.join(dir, "v.db")).size;
    lines.push(`| ${n.toLocaleString()} | ${(insMs / 1000).toFixed(1)}초 | ${pct(ts, 50).toFixed(0)}ms | ${pct(ts, 95).toFixed(0)}ms | ${(size / 1048576).toFixed(0)}MB |`);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // 2) 검색어 임베딩
  const ai = new Ollama(realOllama());
  const tl0 = performance.now();
  await ai.embed("bge-m3", ["준비"]);
  const loadMs = performance.now() - tl0;
  const eq: number[] = [];
  for (const q of ["회의록 정리", "후쿠오카 여행 일정", "리눅스 부팅 과정", "캡스톤 디자인 발표", "데이터베이스 정규화"]) {
    const t = performance.now();
    await ai.embed("bge-m3", [q]);
    eq.push(performance.now() - t);
  }
  lines.push("", "## 검색어 임베딩 (bge-m3)", "", `- 모델 불러오기(이미 올라가 있으면 거의 0): ${(loadMs / 1000).toFixed(1)}초`, `- 검색어 하나: p50 ${pct(eq, 50).toFixed(0)}ms, 최대 ${Math.max(...eq).toFixed(0)}ms`);

  // 3) 실제 DB 하이브리드
  const db = openDb(undefined, { migrate: false });
  const chunks = db.$client.prepare(`SELECT count(*) FROM item_chunks`).pluck().get() as number;
  const hs: number[] = [];
  for (const q of ["회의록 정리", "후쿠오카 여행 일정", "리눅스 부팅 과정", "캡스톤 디자인 발표", "데이터베이스 정규화", "딥러닝 과제"]) {
    const t = performance.now();
    await hybridSearch(db, ai, "bge-m3", q);
    hs.push(performance.now() - t);
  }
  lines.push("", "## 실제 허브 하이브리드 검색 (키워드 + 의미)", "", `- 지금 조각 수: ${chunks.toLocaleString()}개`, `- p50 ${pct(hs, 50).toFixed(0)}ms, 최대 ${Math.max(...hs).toFixed(0)}ms (검색어 임베딩 포함)`);

  // 4) 메모리
  lines.push("", "## 메모리", "", `- Ollama 전체 RSS: ${rss()}GB (bge-m3 상주 + 태그용 exaone 은 쓸 때만)`, `- 시스템 전체 RAM ${Math.round(os.totalmem() / 1073741824)}GB 중 남은 메모리: ${(os.freemem() / 1073741824).toFixed(1)}GB`);
  const out = path.resolve(__dirname, "../../docs/phase4-semantic.md");
  fs.writeFileSync(out, lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  db.$client.close();
}
main();
