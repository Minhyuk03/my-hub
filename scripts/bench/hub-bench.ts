/**
 * Phase 1 성능 측정 (9장): 합성 데이터 10만 개로 검색 p95, 홈 화면 쿼리 시간 측정
 *   npm run bench:hub [-- --items 100000]
 * - 인덱싱 미실행 / 인덱싱 동시 실행(다른 프로세스가 계속 쓰기) 두 조건
 * - 결과: docs/phase1-performance.md
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { openDb, type Db } from "@/server/db";
import { items, sources } from "@/server/db/schema";
import { writeItemText } from "@/server/search/index-writer";
import { search } from "@/server/search/query";
import { activeFolders, recentItems, sourcesWithStats } from "@/server/queries";
import { rand, syntheticDoc } from "./synthetic";

const args = process.argv.slice(2);
const N = Number(args[args.indexOf("--items") + 1] || 100_000) || 100_000;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hub-bench-"));
const file = path.join(dir, "hub.db");

function build(db: Db) {
  const now = Date.now();
  const src = db.insert(sources).values({ kind: "local", name: "합성", rootPath: dir, createdAt: now }).returning().get();
  const r = rand(42);
  let chars = 0;
  const t0 = performance.now();
  const BATCH = 2000;
  for (let i = 0; i < N; i += BATCH) {
    db.transaction(() => {
      for (let j = i; j < Math.min(N, i + BATCH); j++) {
        const d = syntheticDoc(r, j);
        chars += d.body.length;
        const it = db
          .insert(items)
          .values({ sourceId: src.id, path: `${dir}/${d.folder}/${d.title}.md`, title: d.title, ext: "md", kind: "note", size: d.body.length, modifiedAt: now - Math.floor(r() * 365 * 86400_000) })
          .returning({ id: items.id })
          .get();
        writeItemText(db, it.id, { title: d.title, path: `${d.folder}/${d.title}.md`, body: d.body });
      }
    });
    if ((i / BATCH) % 10 === 0) process.stderr.write(`  색인 ${i.toLocaleString()} / ${N.toLocaleString()}\n`);
  }
  return { buildMs: performance.now() - t0, avgChars: Math.round(chars / N) };
}

const QUERIES = ["회의", "회의록", "프로젝트", "노션 동기화", "Claude Code", "2026년 9월", "9월", "동기화", "블로그 리뉴얼", "가"];

function pct(xs: number[], p: number) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

function measure(db: Db, runs = 20) {
  const perQuery: Record<string, { p50: number; p95: number; total: number }> = {};
  const all: number[] = [];
  for (const q of QUERIES) {
    const ts: number[] = [];
    let total = 0;
    for (let i = 0; i < runs; i++) {
      const t = performance.now();
      total = search(db, q, {}, 30).total;
      ts.push(performance.now() - t);
    }
    all.push(...ts);
    perQuery[q] = { p50: pct(ts, 50), p95: pct(ts, 95), total };
  }
  const home: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    const day = Date.now() - 30 * 86400_000;
    recentItems(db, day, 60);
    activeFolders(db, Date.now() - 14 * 86400_000);
    sourcesWithStats(db);
    home.push(performance.now() - t);
  }
  return { perQuery, p95All: pct(all, 95), homeP95: pct(home, 95) };
}

async function main() {
  console.error(`합성 데이터 ${N.toLocaleString()}개 생성: ${file}`);
  const db = openDb(file);
  const b = build(db);
  const size = fs.statSync(file).size + (fs.existsSync(file + "-wal") ? fs.statSync(file + "-wal").size : 0);
  db.$client.pragma("wal_checkpoint(TRUNCATE)");
  console.error("측정: 인덱싱 미실행");
  const idle = measure(db);

  console.error("측정: 인덱싱 동시 실행");
  const writer = spawn(process.execPath, ["--import", "tsx", path.join(__dirname, "writer.ts"), file], { stdio: ["ignore", "ignore", "inherit"] });
  await new Promise((r) => setTimeout(r, 1500));
  const busy = measure(db);
  writer.kill("SIGTERM");

  const lines = [
    `# Phase 1 성능 측정`,
    "",
    `- 측정: ${new Date().toISOString()} / ${os.cpus()[0].model} / RAM ${Math.round(os.totalmem() / 1073741824)}GB / Node ${process.version}`,
    `- 조건: 항목 ${N.toLocaleString()}개, 평균 본문 ${b.avgChars.toLocaleString()}자, 키워드 검색(B2), 결과 30개, 청크 없음 (의미 검색은 Phase 4)`,
    `- 색인 생성 ${(b.buildMs / 1000).toFixed(0)}초, DB 크기 ${(size / 1048576).toFixed(0)}MB`,
    `- "인덱싱 중" 조건: 다른 프로세스가 같은 DB에 계속 항목을 쓰는 상태`,
    "",
    `| 검색어 | 결과 수 | p95 (인덱싱 없음) | p95 (인덱싱 중) |`,
    `|---|---|---|---|`,
    ...QUERIES.map((q) => `| ${q} | ${idle.perQuery[q].total.toLocaleString()} | ${idle.perQuery[q].p95.toFixed(1)}ms | ${busy.perQuery[q].p95.toFixed(1)}ms |`),
    `| **전체 p95** | | **${idle.p95All.toFixed(1)}ms** (목표 500ms) | **${busy.p95All.toFixed(1)}ms** (목표 1500ms) |`,
    `| **홈 화면 쿼리 p95** | | **${idle.homeP95.toFixed(1)}ms** (목표 1000ms) | **${busy.homeP95.toFixed(1)}ms** |`,
    "",
    "홈 화면 쿼리: 최근 수정 60개 + 이어서 작업하기 + 소스 상태. 화면 렌더링 시간은 포함하지 않음.",
  ];
  const out = path.resolve(__dirname, "../../docs/phase1-performance.md");
  fs.writeFileSync(out, lines.join("\n") + "\n");
  console.log(lines.join("\n"));
  db.$client.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

main();
