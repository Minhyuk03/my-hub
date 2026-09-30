/**
 * Phase 0: 한국어 키워드 검색 방식 비교 검증
 *
 * 사용법:
 *   npx tsx scripts/phase0/korean-search-bench.ts [--vault <경로>] [--scale 100000]
 *
 * - 볼트의 .md 파일은 읽기만 한다. iCloud에서 내려받지 않은(dataless) 파일은 읽으면 다운로드가
 *   시작되므로 건너뛰고 개수만 센다. (실제 인덱서도 같은 규칙: cloud_only)
 * - 결과는 data/phase0/korean-search.json 과 docs/phase0-korean-search.md 에 저장한다.
 *   노트 본문은 저장하지 않고, 제목·개수·시간만 저장한다.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { isDataless } from "../../src/lib/fs/dataless";

const args = process.argv.slice(2);
const argVal = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const VAULT =
  argVal("--vault") ??
  "/Users/mh/Library/Mobile Documents/iCloud~md~obsidian/Documents";
const SCALE = Number(argVal("--scale") ?? 0);
const READ_TIMEOUT_MS = 15000;

type Doc = { id: number; title: string; body: string; origin: "vault" | "sample" };

// ---------- 정규화 ----------
export const nfc = (s: string) => s.normalize("NFC");

// ---------- 코퍼스 ----------
function samples(): Omit<Doc, "id">[] {
  // NFD 제목은 macOS Finder에서 만든 한글 파일 이름을 흉내 낸다.
  const nfd = (s: string) => s.normalize("NFD");
  return [
    { title: nfd("주간회의록 2026-09-28"), body: "", origin: "sample" },
    { title: "회의 준비 메모", body: "다음 주 회의 준비: 안건 정리", origin: "sample" },
    { title: "팀 회의록", body: "회의록 초안입니다. 참석자 3명", origin: "sample" },
    { title: "주간회의 정리", body: "주간회의에서 나온 이야기", origin: "sample" },
    { title: "블로그 리뉴얼 기획", body: "프로젝트를 시작한다. 프로젝트에서 중요한 것은 일정이다.", origin: "sample" },
    { title: "동기화 설계", body: "노션 페이지를 옵시디언으로 옮긴 뒤 한참 후에 동기화를 한다.", origin: "sample" },
    { title: "노션만 있는 문서", body: "노션 워크스페이스 정리", origin: "sample" },
    { title: "CLAUDE CODE 사용기", body: "claude code 세션 기록과 2026년 9월 계획", origin: "sample" },
    { title: "9월 일정", body: "2026년 9월 30일 마감. 9월 말까지.", origin: "sample" },
    { title: "회의적인 의견", body: "이 방식에는 회의적이다", origin: "sample" }, // 부분 문자열 방식의 잡음 사례
  ];
}

async function readWithTimeout(p: string): Promise<string | null> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), READ_TIMEOUT_MS);
  try {
    return await fsp.readFile(p, { encoding: "utf8", signal: ac.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function loadVault(root: string): Promise<{ docs: Omit<Doc, "id">[]; failed: number; total: number; cloudOnly: number }> {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".md")) files.push(p);
    }
  };
  if (!fs.existsSync(root)) return { docs: [], failed: 0, total: 0, cloudOnly: 0 };
  walk(root);
  let cloudOnly = 0;
  const docs: Omit<Doc, "id">[] = [];
  let failed = 0;
  let done = 0;
  const queue = [...files];
  const worker = async () => {
    while (queue.length) {
      const p = queue.shift()!;
      if (isDataless(p, fs.statSync(p))) { cloudOnly++; done++; continue; }
      const body = await readWithTimeout(p);
      done++;
      if (done % 100 === 0) process.stderr.write(`  볼트 읽는 중 ${done}/${files.length}\n`);
      if (body == null) { failed++; continue; }
      docs.push({ title: path.basename(p, ".md"), body, origin: "vault" });
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return { docs, failed, total: files.length, cloudOnly };
}

// ---------- 색인 방식 ----------
const JOSA = ["에서는", "에게서", "으로써", "으로서", "에서", "에게", "으로", "부터", "까지", "처럼", "이나", "이다", "을", "를", "이", "가", "은", "는", "에", "로", "와", "과", "의", "도", "만", "나"];
export function stripJosa(tok: string): string {
  if (!/[가-힣]$/.test(tok)) return tok;
  for (const j of JOSA) {
    if (tok.length > j.length + 1 && tok.endsWith(j)) return tok.slice(0, -j.length);
  }
  return tok;
}
const tokens = (s: string) => nfc(s).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
export function toBigrams(s: string): string {
  const out: string[] = [];
  for (const t of tokens(s)) {
    if (t.length === 1) out.push(t);
    for (let i = 0; i + 2 <= t.length; i++) out.push(t.slice(i, i + 2));
  }
  return out.join(" ");
}
const q = (t: string) => `"${t.replace(/"/g, '""')}"`;

type Method = {
  key: string;
  name: string;
  build(db: Database.Database, docs: Doc[]): void;
  search(db: Database.Database, query: string): number[];
};

const METHODS: Method[] = [
  {
    key: "unicode61",
    name: "A. unicode61 (기본) + 접두어 검색",
    build(db, docs) {
      db.exec(`create virtual table a using fts5(title, body)`);
      const ins = db.prepare(`insert into a(rowid,title,body) values(?,?,?)`);
      for (const d of docs) ins.run(d.id, nfc(d.title), nfc(d.body));
    },
    search(db, query) {
      const terms = tokens(query);
      if (!terms.length) return [];
      const m = terms.map((t) => `${q(t)}*`).join(" AND ");
      return db.prepare(`select rowid from a where a match ?`).pluck().all(m) as number[];
    },
  },
  {
    key: "trigram_like",
    name: "B1. trigram + 2글자 이하는 LIKE",
    build(db, docs) {
      db.exec(`create virtual table b1 using fts5(title, body, tokenize='trigram')`);
      db.exec(`create table docs_raw(id integer primary key, title text, body text)`);
      const ins = db.prepare(`insert into b1(rowid,title,body) values(?,?,?)`);
      const raw = db.prepare(`insert into docs_raw values(?,?,?)`);
      for (const d of docs) {
        ins.run(d.id, nfc(d.title), nfc(d.body));
        raw.run(d.id, nfc(d.title).toLowerCase(), nfc(d.body).toLowerCase());
      }
    },
    search(db, query) {
      const terms = tokens(query);
      if (!terms.length) return [];
      const long = terms.filter((t) => t.length >= 3);
      const short = terms.filter((t) => t.length < 3);
      let sql: string;
      const params: string[] = [];
      if (long.length) {
        sql = `select rowid from b1 where b1 match ?`;
        params.push(long.map(q).join(" AND "));
        for (const s of short) {
          sql += ` and rowid in (select id from docs_raw where title like ? or body like ?)`;
          params.push(`%${s}%`, `%${s}%`);
        }
      } else {
        sql = `select id from docs_raw where ` + short.map(() => `(title like ? or body like ?)`).join(" and ");
        for (const s of short) params.push(`%${s}%`, `%${s}%`);
      }
      return db.prepare(sql).pluck().all(...params) as number[];
    },
  },
  {
    key: "trigram_bigram",
    name: "B2. trigram + 2글자 bigram 보조 색인 (1글자는 LIKE)",
    build(db, docs) {
      db.exec(`create virtual table b2 using fts5(title, body, tokenize='trigram')`);
      db.exec(`create virtual table b2g using fts5(grams)`);
      const ins = db.prepare(`insert into b2(rowid,title,body) values(?,?,?)`);
      const insg = db.prepare(`insert into b2g(rowid,grams) values(?,?)`);
      for (const d of docs) {
        ins.run(d.id, nfc(d.title), nfc(d.body));
        insg.run(d.id, toBigrams(d.title + " " + d.body));
      }
    },
    search(db, query) {
      const terms = tokens(query);
      if (!terms.length) return [];
      const long = terms.filter((t) => t.length >= 3);
      const two = terms.filter((t) => t.length === 2);
      const one = terms.filter((t) => t.length === 1);
      const parts: string[] = [];
      const params: string[] = [];
      if (long.length) {
        parts.push(`select rowid from b2 where b2 match ?`);
        params.push(long.map(q).join(" AND "));
      }
      if (two.length) {
        parts.push(`select rowid from b2g where b2g match ?`);
        params.push(two.map(q).join(" AND "));
      }
      // 1글자는 색인으로 찾을 수 없어 trigram 테이블을 LIKE로 훑는다 (드문 경우)
      for (const t of one) {
        parts.push(`select rowid from b2 where title like ? or body like ?`);
        params.push(`%${t}%`, `%${t}%`);
      }
      return db.prepare(parts.join(" intersect ")).pluck().all(...params) as number[];
    },
  },
  {
    key: "josa_strip",
    name: "C. 조사 제거 전처리 + unicode61 접두어",
    build(db, docs) {
      db.exec(`create virtual table c using fts5(title, body)`);
      const ins = db.prepare(`insert into c(rowid,title,body) values(?,?,?)`);
      const prep = (s: string) => tokens(s).map(stripJosa).join(" ");
      for (const d of docs) ins.run(d.id, prep(d.title), prep(d.body));
    },
    search(db, query) {
      const terms = tokens(query).map(stripJosa);
      if (!terms.length) return [];
      return db.prepare(`select rowid from c where c match ?`).pluck().all(terms.map((t) => `${q(t)}*`).join(" AND ")) as number[];
    },
  },
];

// ---------- 정답 기준 ----------
// "검색어의 모든 단어가 제목 또는 본문 어딘가에 부분 문자열로 들어 있으면 찾아야 한다" (대소문자 무시, NFC)
function gold(docs: Doc[], query: string): Set<number> {
  const terms = tokens(query);
  const s = new Set<number>();
  for (const d of docs) {
    const hay = nfc(d.title + "\n" + d.body).toLowerCase();
    if (terms.every((t) => hay.includes(t))) s.add(d.id);
  }
  return s;
}

const CASES = [
  { query: "회의", expect: "회의록, 주간회의, 회의 준비 가 들어간 문서 모두" },
  { query: "회의록", expect: "주간회의록처럼 붙여 쓴 경우 포함" },
  { query: "프로젝트", expect: "프로젝트를, 프로젝트에서 등 조사 붙은 형태" },
  { query: "노션 동기화", expect: "두 단어가 떨어져 있어도 모두 포함된 문서" },
  { query: "Claude Code", expect: "대소문자 무시" },
  { query: "claude code", expect: "소문자 입력" },
  { query: "2026년 9월", expect: "숫자 포함 일치" },
  { query: "9월", expect: "2글자 숫자+한글" },
  { query: "동기화", expect: "3글자" },
  { query: "일", expect: "1글자 (참고용)" },
];

function pctl(xs: number[], p: number) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

type CaseResult = {
  query: string;
  expect: string;
  gold: number;
  found: number;
  recall: number;
  extra: number;
  p50: number;
  p95: number;
  missedSampleTitles: string[];
};
type BenchResult = { label: string; method: string; name: string; docs: number; buildMs: number; sizeBytes: number; cases: CaseResult[] };
type Report = {
  createdAt: string;
  env: { node: string; sqlite: unknown };
  corpus: { vaultTotal: number; vaultRead: number; vaultFailed: number; vaultCloudOnly: number; samples: number; avgBodyChars: number };
  results: BenchResult[];
};

function runBench(docs: Doc[], label: string): BenchResult[] {
  const out: BenchResult[] = [];
  for (const m of METHODS) {
    const db = new Database(":memory:");
    const t0 = performance.now();
    db.transaction(() => m.build(db, docs))();
    const buildMs = performance.now() - t0;
    const pageCount = db.pragma("page_count", { simple: true }) as number;
    const pageSize = db.pragma("page_size", { simple: true }) as number;
    const perCase = CASES.map((c) => {
      const g = gold(docs, c.query);
      const times: number[] = [];
      let got: number[] = [];
      for (let i = 0; i < 20; i++) {
        const t = performance.now();
        got = m.search(db, c.query);
        times.push(performance.now() - t);
      }
      const gotSet = new Set(got);
      const hit = [...g].filter((id) => gotSet.has(id)).length;
      const missed = [...g].filter((id) => !gotSet.has(id));
      const extra = got.filter((id) => !g.has(id));
      return {
        query: c.query,
        expect: c.expect,
        gold: g.size,
        found: got.length,
        recall: g.size ? hit / g.size : 1,
        extra: extra.length,
        p50: pctl(times, 50),
        p95: pctl(times, 95),
        missedSampleTitles: missed
          .map((id) => docs[id - 1])
          .filter((d) => d.origin === "sample")
          .map((d) => nfc(d.title)),
      };
    });
    out.push({ label, method: m.key, name: m.name, docs: docs.length, buildMs, sizeBytes: pageCount * pageSize, cases: perCase });
    db.close();
  }
  return out;
}

async function main() {
  console.error(`볼트 읽기: ${VAULT}`);
  const v = await loadVault(VAULT);
  console.error(`볼트 .md ${v.total}개 중 ${v.docs.length}개 읽음, 내려받지 않은 파일 ${v.cloudOnly}개 건너뜀, 실패 ${v.failed}개`);
  const base = [...samples(), ...v.docs].map((d, i) => ({ ...d, id: i + 1 }) as Doc);
  const results = runBench(base, "실제 데이터");

  let scaled: BenchResult[] = [];
  if (SCALE > base.length) {
    // 볼트 본문을 반복·조합해 SCALE개 문서를 만든다 (속도 측정용)
    const big: Doc[] = [];
    for (let i = 0; i < SCALE; i++) {
      const a = base[i % base.length];
      const b = base[(i * 7 + 3) % base.length];
      big.push({ id: i + 1, title: `${a.title} ${i}`, body: (a.body + "\n" + b.body).slice(0, 4000), origin: "vault" });
    }
    console.error(`확장 데이터 ${SCALE}개로 속도 측정`);
    scaled = runBench(big, `확장 데이터 ${SCALE}개`);
  }

  const avgLen = Math.round(base.reduce((s, d) => s + d.body.length, 0) / base.length);
  const report: Report = {
    createdAt: new Date().toISOString(),
    env: { node: process.version, sqlite: new Database(":memory:").prepare("select sqlite_version()").pluck().get() },
    corpus: { vaultTotal: v.total, vaultRead: v.docs.length, vaultFailed: v.failed, vaultCloudOnly: v.cloudOnly, samples: samples().length, avgBodyChars: avgLen },
    results: [...results, ...scaled],
  };
  const root = path.resolve(__dirname, "../..");
  fs.mkdirSync(path.join(root, "data/phase0"), { recursive: true });
  fs.writeFileSync(path.join(root, "data/phase0/korean-search.json"), JSON.stringify(report, null, 2));
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs/phase0-korean-search.md"), toMarkdown(report));
  console.log(toMarkdown(report));
}

function toMarkdown(r: Report): string {
  const lines: string[] = [];
  lines.push(`# Phase 0 한국어 검색 방식 비교`, "");
  lines.push(`- 측정: ${r.createdAt} / Node ${r.env.node} / SQLite ${r.env.sqlite}`);
  lines.push(`- 데이터: 볼트 노트 ${r.corpus.vaultRead}개 (전체 ${r.corpus.vaultTotal}개 중 내려받지 않은 ${r.corpus.vaultCloudOnly}개 제외, 읽기 실패 ${r.corpus.vaultFailed}) + 검증용 샘플 ${r.corpus.samples}개, 평균 본문 ${r.corpus.avgBodyChars}자`);
  lines.push(`- 정답 기준: 검색어의 모든 단어가 제목·본문에 부분 문자열로 들어 있는 문서 (대소문자 무시, 한글 NFC 정규화)`, "");
  const labels = [...new Set(r.results.map(x => x.label))];
  for (const label of labels) {
    const rs = r.results.filter(x => x.label === label);
    lines.push(`## ${label}`, "");
    lines.push(`| 검색어 | 정답 수 | ` + rs.map(x => x.name).join(" | ") + " |");
    lines.push(`|---|---|` + rs.map(() => "---|").join(""));
    for (let i = 0; i < rs[0].cases.length; i++) {
      const c0 = rs[0].cases[i];
      lines.push(
        `| ${c0.query} | ${c0.gold} | ` +
          rs
            .map(x => {
              const c = x.cases[i];
              return `${Math.round(c.recall * 100)}% (${c.found}건, ${c.p95.toFixed(1)}ms)`;
            })
            .join(" | ") +
          " |",
      );
    }
    lines.push(`| **색인 시간 / 크기** | | ` + rs.map(x => `${(x.buildMs / 1000).toFixed(1)}s / ${(x.sizeBytes / 1048576).toFixed(1)}MB`).join(" | ") + " |", "");
    const misses = rs.flatMap(x => x.cases.filter(c => c.missedSampleTitles.length).map(c => `- ${x.name} / "${c.query}" 놓친 샘플: ${c.missedSampleTitles.join(", ")}`));
    if (misses.length) lines.push(`놓친 검증 샘플:`, "", ...misses, "");
  }
  lines.push(`표의 값: 찾아야 할 문서 중 찾은 비율(재현율) (찾은 건수, p95 응답시간)`);
  return lines.join("\n");
}

if (require.main === module) main();
