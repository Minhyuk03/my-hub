/**
 * 파일 정리용 로컬 모델 비교 (내 실제 자료로 채점)
 *   ~/Library/Application\ Support/my-hub/runtime/current/bin/node --import tsx scripts/ai/bench-organize.ts
 *
 * 1) 태그·PARA (대화 모델): 내가 직접 태그를 단 Obsidian 노트에서 태그를 지우고 허브와 같은 지시문으로 태그를 제안하게 한 뒤
 *    내 태그와 얼마나 맞는지(정확도·재현율), PARA 폴더(1~4)를 폴더 이름 없이 맞히는지, 속도·메모리·형식을 잰다.
 * 2) 임베딩: 내가 정리한 프로젝트·영역·자료 묶음을 정답으로 삼아, 가장 비슷한 문서 5개 중 같은 묶음 비율(P@5)과
 *    이웃 투표로 묶음을 맞히는 비율(허브의 묶음 제안 방식)을 잰다.
 * 측정 중에는 워커의 백그라운드 AI 정리를 멈춘다. 결과: data/ai/organize-bench.md (노트 내용이 들어가 git 제외)
 */
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { markForeground } from "@/server/ai/foreground";
import { cleanTags, tagPrompt } from "@/server/ai/pipeline";
import { Ollama, realOllama } from "@/server/ai/ollama";
import { openDb } from "@/server/db";
import { membershipSql } from "@/server/projects";
import { getSettings } from "@/server/settings";
import { aliasAll } from "@/server/tags";

const CHAT = process.env.CHAT?.split(",") ?? ["exaone3.5:2.4b", "gemma3:4b", "qwen3.5:4b", "gemma4:latest"];
const EMBED = process.env.EMBED?.split(",") ?? ["bge-m3", "qwen3-embedding:0.6b"];
const N_TAG = Number(process.env.N_TAG ?? 24);
const OLLAMA = "http://127.0.0.1:11434";

const db = openDb(undefined, { migrate: false });
const c = db.$client;
const s = getSettings(db);
const ai = new Ollama(realOllama());
const nfc = (x: string) => x.normalize("NFC");
const sha = (x: string) => crypto.createHash("sha1").update(x).digest("hex");
const med = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "-");

function ollamaRssGB() {
  let kb = 0;
  for (const l of execFileSync("/bin/ps", ["-axo", "rss,comm"], { encoding: "utf8" }).split("\n")) if (/ollama|llama-server/i.test(l)) kb += parseInt(l.trim()) || 0;
  return kb / 1048576;
}
async function unloadAll() {
  const ps = (await fetch(OLLAMA + "/api/ps").then((r) => r.json())) as { models: { name: string }[] };
  for (const m of ps.models) await fetch(OLLAMA + "/api/generate", { method: "POST", body: JSON.stringify({ model: m.name, keep_alive: 0 }) }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2000));
}

// ---------- 1) 태그·PARA ----------
type Note = { id: number; title: string; path: string; kind: string; body: string; truth: string[]; para: string };
const PARA_OF: Record<string, string> = { "1": "project", "2": "area", "3": "resource", "4": "archive" };

function sampleNotes(): Note[] {
  const vault = c.prepare(`SELECT root_path FROM sources WHERE kind = 'obsidian'`).pluck().get() as string;
  const rows = c
    .prepare(
      `SELECT i.id, i.title, i.path, i.kind, t.body FROM items i JOIN item_text t ON t.item_id = i.id
       WHERE i.state = 'ok' AND i.ext = 'md' AND i.path LIKE ? AND length(t.body) > 400`,
    )
    .all(vault + "/%") as Omit<Note, "truth" | "para">[];
  const tagsOf = c.prepare(`SELECT g.name FROM item_tags it JOIN tags g ON g.id = it.tag_id WHERE it.item_id = ?`).pluck();
  const structural = new Set(s.aiStructuralTags.map((x) => x.toLowerCase()));
  const byPara = new Map<string, Note[]>();
  for (const r of rows) {
    const top = nfc(r.path.slice(vault.length + 1)).split("/")[0];
    const para = PARA_OF[top[0]];
    if (!para || !/^\d\.\s/.test(top)) continue;
    const truth = aliasAll(s.tagAliases, tagsOf.all(r.id) as string[]).filter((t) => !structural.has(t.split("/")[0].toLowerCase()));
    if (truth.length < 2) continue;
    // 정답이 새지 않게: 본문의 #태그와 앞머리(frontmatter) 태그를 지우고, 폴더에서 PARA 칸(1~4) 이름을 뺀다
    const body = r.body
      .replace(/^---[\s\S]*?\n---\n?/, "")
      .replace(/(^|\s)#[^\s#]+/g, " ")
      .replace(/^\s*tags:.*$/gim, "");
    const relPath = nfc(r.path.slice(vault.length + 1)).split("/").slice(1).join("/");
    const n = { ...r, body, truth, para, path: `${vault}/${relPath}` };
    byPara.set(para, [...(byPara.get(para) ?? []), n]);
  }
  // PARA 칸마다 고르게, 같은 칸 안에서는 가장 최근 것부터
  const out: Note[] = [];
  for (let i = 0; out.length < N_TAG && [...byPara.values()].some((l) => l.length > i); i++) for (const l of byPara.values()) if (l[i] && out.length < N_TAG) out.push(l[i]);
  return out;
}

const SCHEMA = {
  type: "object",
  properties: { tags: { type: "array", items: { type: "string" }, maxItems: 5 }, para: { type: "string", enum: ["project", "area", "resource", "archive"] }, summary: { type: "string" } },
  required: ["tags", "para", "summary"],
};

async function benchChat(notes: Note[]) {
  const structural = s.aiStructuralTags.map((x) => x.toLowerCase());
  const vocab = (c.prepare(`SELECT g.name, count(*) n FROM tags g JOIN v_item_tags it ON it.tag_id = g.id GROUP BY g.id ORDER BY n DESC LIMIT 80`).all() as { name: string }[])
    .map((r) => r.name)
    .filter((n) => !structural.includes(n.split("/")[0].toLowerCase()));
  const rows: string[] = [];
  const samples: string[] = [];
  for (const model of CHAT) {
    await unloadAll();
    const t0 = performance.now();
    await ai.chatJson(model, [{ role: "user", content: "{}" }], SCHEMA).catch(() => null);
    const load = performance.now() - t0;
    let hit = 0, sug = 0, tru = 0, paraOk = 0, ok = 0, mem = 0;
    const times: number[] = [];
    for (const n of notes) {
      const t = performance.now();
      try {
        const out = await ai.chatJson<{ tags?: string[]; para?: string; summary?: string }>(model, tagPrompt(vocab, n), SCHEMA);
        times.push(performance.now() - t);
        ok++;
        const tags = aliasAll(s.tagAliases, cleanTags(out.tags ?? [], s.aiStructuralTags, []));
        const truth = new Set(n.truth.map((x) => x.toLowerCase()));
        const h = tags.filter((x) => truth.has(x.toLowerCase()) || [...truth].some((y) => y.split("/")[0] === x.toLowerCase())).length;
        hit += h;
        sug += tags.length;
        tru += truth.size;
        if (out.para === n.para) paraOk++;
        if (samples.length < CHAT.length * 3 && notes.indexOf(n) < 3)
          samples.push(`- **${model}** · ${n.title} — 내 태그 [${n.truth.join(", ")}] / 제안 [${tags.join(", ")}] · PARA 정답 ${n.para}, 답 ${out.para}`);
      } catch {
        times.push(performance.now() - t);
      }
      mem = Math.max(mem, ollamaRssGB());
    }
    rows.push(
      `| ${model} | ${(load / 1000).toFixed(1)}초 | ${(med(times) / 1000).toFixed(1)}초 | ${pct(hit, sug)} | ${pct(hit, tru)} | ${pct(paraOk, notes.length)} | ${ok}/${notes.length} | ${mem.toFixed(1)}GB |`,
    );
    console.log(rows.at(-1));
  }
  return { rows, samples };
}

// ---------- 2) 임베딩 ----------
type Doc = { id: number; group: number; text: string; hash: string };
function sampleDocs(): Doc[] {
  const groups = c.prepare(`SELECT id FROM projects`).pluck().all() as number[];
  const owner = new Map<number, number[]>();
  for (const g of groups) {
    const m = membershipSql(db, g);
    for (const id of c.prepare(m.sql).pluck().all(...m.params) as number[]) owner.set(id, [...(owner.get(id) ?? []), g]);
  }
  const ids = [...owner].filter(([, gs]) => gs.length === 1).map(([id]) => id);
  const rows: Doc[] = [];
  const get = c.prepare(
    `SELECT i.id, i.title, i.path, coalesce(t.body, '') body FROM items i LEFT JOIN item_text t ON t.item_id = i.id WHERE i.id = ? AND i.state != 'deleted' AND i.kind IN ('note','document','pdf','code','chat')`,
  );
  const perGroup = new Map<number, number>();
  for (const id of ids) {
    const r = get.get(id) as { id: number; title: string; path: string; body: string } | undefined;
    if (!r) continue;
    const g = owner.get(id)![0];
    if ((perGroup.get(g) ?? 0) >= 30) continue;
    perGroup.set(g, (perGroup.get(g) ?? 0) + 1);
    const dir = nfc(r.path).replace(/^[a-z]+:\/[^/]+/, "").replace(/#[A-Za-z0-9_-]+/g, "").split("/").slice(-3, -1).join("/");
    const text = `${r.title}\n${dir}\n${r.body.slice(0, 1500)}`;
    rows.push({ id, group: g, text, hash: sha(r.body || r.title) });
  }
  const big = new Set([...perGroup].filter(([, n]) => n >= 4).map(([g]) => g));
  return rows.filter((r) => big.has(r.group));
}

async function benchEmbed(docs: Doc[]) {
  const rows: string[] = [];
  for (const model of EMBED) {
    await unloadAll();
    const t0 = performance.now();
    const vecs: Float32Array[] = [];
    for (let i = 0; i < docs.length; i += 8) {
      for (const v of await ai.embed(model, docs.slice(i, i + 8).map((d) => d.text), "5m")) {
        let n = 0;
        for (const x of v) n += x * x;
        n = Math.sqrt(n) || 1;
        vecs.push(Float32Array.from(v, (x) => x / n));
      }
    }
    const ms = performance.now() - t0;
    const mem = ollamaRssGB();
    let p5 = 0, voteOk = 0, voted = 0;
    for (let i = 0; i < docs.length; i++) {
      const near = docs
        .map((d, j) => ({ j, sim: j === i || d.hash === docs[i].hash ? -2 : vecs[i].reduce((a, x, k) => a + x * vecs[j][k], 0) }))
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 7);
      p5 += near.slice(0, 5).filter((x) => docs[x.j].group === docs[i].group).length / 5;
      const votes = new Map<number, number>();
      for (const x of near) votes.set(docs[x.j].group, (votes.get(docs[x.j].group) ?? 0) + 1);
      const best = [...votes].sort((a, b) => b[1] - a[1])[0];
      if (best && best[1] >= 4) {
        voted++;
        if (best[0] === docs[i].group) voteOk++;
      }
    }
    rows.push(
      `| ${model} | ${(ms / 1000).toFixed(1)}초 (${((docs.length / ms) * 1000).toFixed(0)}개/초) | ${pct(p5, docs.length)} | ${pct(voteOk, voted)} (${voted}개 제안) | ${mem.toFixed(1)}GB |`,
    );
    console.log(rows.at(-1));
  }
  return rows;
}

async function main() {
  markForeground(db, 60 * 60_000); // 측정하는 동안 워커의 AI 정리 멈춤
  const notes = sampleNotes();
  const docs = sampleDocs();
  console.log(`태그 시험 노트 ${notes.length}개, 임베딩 시험 문서 ${docs.length}개 (묶음 ${new Set(docs.map((d) => d.group)).size}개)`);
  const chat = await benchChat(notes);
  const emb = await benchEmbed(docs);
  await unloadAll();
  markForeground(db, 0);
  c.prepare(`UPDATE runtime SET value = json('{"until":0}') WHERE key = 'chat_active'`).run();
  const paraCount = Object.entries(notes.reduce<Record<string, number>>((a, n) => ({ ...a, [n.para]: (a[n.para] ?? 0) + 1 }), {}))
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
  const out = [
    "# 파일 정리용 로컬 모델 비교",
    "",
    `- 측정: ${new Date().toLocaleString("ko-KR")} / Mac mini M4 16GB / 측정 중 백그라운드 AI 정리 멈춤`,
    "",
    "## 태그·PARA (대화 모델)",
    "",
    `- 내가 직접 태그를 단 Obsidian 노트 ${notes.length}개 (PARA: ${paraCount}). 본문의 태그와 PARA 폴더 이름을 지우고, 허브와 같은 지시문·같은 기존 태그 목록으로 제안하게 함`,
    "- 정확도: 제안한 태그 중 내 태그와 같은 비율 / 재현율: 내 태그 중 제안된 비율 (태그 합치기 규칙 적용, 상위 태그가 같으면 맞음)",
    "",
    "| 모델 | 처음 불러오기 | 문서당 | 태그 정확도 | 태그 재현율 | PARA 맞힘 | 형식 맞음 | Ollama 메모리 |",
    "|---|---|---|---|---|---|---|---|",
    ...chat.rows,
    "",
    "## 임베딩 (비슷한 문서 찾기)",
    "",
    `- 정답: 내가 정리한 프로젝트·영역·자료 묶음 (한 묶음에만 속한 문서, 묶음당 최대 30개, 4개 이상인 묶음). 문서 ${docs.length}개`,
    "- P@5: 가장 비슷한 문서 5개 중 같은 묶음 비율 / 투표: 이웃 7개 중 4개 이상이 같은 묶음일 때 제안 → 그 제안이 맞은 비율",
    "",
    "| 모델 | 임베딩 시간 | P@5 | 투표 맞힘 | Ollama 메모리 |",
    "|---|---|---|---|---|",
    ...emb,
    "",
    "## 예시",
    "",
    ...chat.samples,
    "",
  ].join("\n");
  const f = path.resolve(__dirname, "../../data/ai/organize-bench.md");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, out);
  console.log("→", f);
}
main();
