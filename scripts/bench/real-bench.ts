/**
 * 실제 허브 성능 측정 (9장 목표: 검색 p95 0.5초, 인덱싱 중 1.5초 / 홈 1초)
 *   npx tsx scripts/bench/real-bench.ts
 * 운영 중인 웹 서버(127.0.0.1:3000)에 실제 요청을 보내 화면 전체 응답 시간을 잰다 (서버 렌더링 포함).
 * 결과: docs/phase6-performance.md
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { openDb } from "@/server/db";

const BASE = "http://127.0.0.1:3000";
const QUERIES = ["회의", "회의록", "프로젝트", "리눅스 부팅", "캡스톤 발표", "Claude Code", "2026년 9월", "데이터베이스 정규화", "후쿠오카 여행", "딥러닝 과제", "기말고사", "노션 동기화", "ESP32", "예산", "할 일"];
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];

async function time(url: string) {
  const t = performance.now();
  const r = await fetch(BASE + url);
  await r.text();
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return performance.now() - t;
}

async function main() {
  const db = openDb(undefined, { migrate: false });
  const c = db.$client;
  const stats = c
    .prepare(
      `SELECT (SELECT count(*) FROM items WHERE state != 'deleted') AS items,
              (SELECT count(*) FROM item_chunks) AS chunks,
              (SELECT avg(length(body)) FROM item_text WHERE length(body) > 0) AS avgBody,
              (SELECT count(*) FROM scan_jobs WHERE result = 'running') AS running`,
    )
    .get() as { items: number; chunks: number; avgBody: number; running: number };
  db.$client.close();
  // 데우기
  for (const q of QUERIES.slice(0, 3)) await time(`/search?q=${encodeURIComponent(q)}&mode=hybrid`);

  const rows: string[] = [];
  const measure = async (label: string, urls: string[]) => {
    const ts: number[] = [];
    for (const u of urls) ts.push(await time(u));
    rows.push(`| ${label} | ${urls.length} | ${pct(ts, 50).toFixed(0)}ms | ${pct(ts, 95).toFixed(0)}ms | ${Math.max(...ts).toFixed(0)}ms |`);
    console.log(rows.at(-1));
  };
  await measure("키워드 검색 API (/api/search)", QUERIES.map((q) => `/api/search?q=${encodeURIComponent(q)}`));
  await measure("검색 화면 · 키워드", QUERIES.map((q) => `/search?q=${encodeURIComponent(q)}&mode=keyword`));
  await measure("검색 화면 · 섞어서 (처음 검색어)", QUERIES.map((q) => `/search?q=${encodeURIComponent(q + " 정리")}&mode=hybrid`));
  await measure("검색 화면 · 섞어서 (다시 검색)", QUERIES.map((q) => `/search?q=${encodeURIComponent(q + " 정리")}&mode=hybrid`));
  await measure("홈 화면", Array.from({ length: 10 }, () => "/"));

  const out = [
    "# 실제 허브 성능 측정 (Phase 6)",
    "",
    `- 측정: ${new Date().toLocaleString("ko-KR")} / ${os.cpus()[0].model} / RAM ${Math.round(os.totalmem() / 1073741824)}GB`,
    `- 항목 ${stats.items.toLocaleString()}개, 평균 본문 ${Math.round(stats.avgBody).toLocaleString()}자, 의미 검색 조각 ${stats.chunks.toLocaleString()}개, 측정 중 스캔 ${stats.running ? "실행 중" : "없음"} (워커의 AI 정리는 평소대로 동작)`,
    "- 화면 전체 응답 시간 (서버 렌더링 포함, 같은 Mac 에서 요청). 목표: 검색 p95 0.5초(인덱싱 중 1.5초), 홈 1초",
    "",
    "| 측정 | 횟수 | p50 | p95 | 최대 |",
    "|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
  fs.writeFileSync(path.resolve(__dirname, "../../docs/phase6-performance.md"), out);
  console.log(out);
}
main();
