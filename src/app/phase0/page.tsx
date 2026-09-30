import fs from "node:fs";
import path from "node:path";
import { connection } from "next/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { runEnvCheck } from "@/lib/env-check";

type Bench = {
  createdAt: string;
  corpus: { vaultTotal: number; vaultRead: number; vaultCloudOnly: number; samples: number; avgBodyChars: number };
  results: {
    label: string;
    method: string;
    name: string;
    docs: number;
    buildMs: number;
    sizeBytes: number;
    cases: { query: string; expect: string; gold: number; found: number; recall: number; p95: number }[];
  }[];
};

function loadBench(): Bench | null {
  const p = path.join(process.cwd(), "data/phase0/korean-search.json");
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const gb = (n?: number) => (n == null ? "-" : `${(n / 1e9).toFixed(0)}GB`);

function Ok({ ok, yes = "정상", no = "문제" }: { ok: boolean; yes?: string; no?: string }) {
  return <Badge variant={ok ? "secondary" : "destructive"}>{ok ? yes : no}</Badge>;
}

export default async function Phase0Page() {
  await connection();
  const env = runEnvCheck();
  const bench = loadBench();
  const labels = bench ? [...new Set(bench.results.map((r) => r.label))] : [];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Phase 0 점검</h1>

      <Card>
        <CardHeader>
          <CardTitle>환경·경로·권한</CardTitle>
          <CardDescription>
            이 화면을 띄운 서버 프로세스 기준입니다. Node {env.node} ({env.nodeExecPath})
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <ul className="space-y-2">
            {env.paths.map((p) => (
              <li key={p.path} className="flex flex-wrap items-center gap-2">
                <Ok ok={p.exists && p.readable} yes="읽기 가능" no={p.exists ? "권한 없음" : "없음"} />
                <span className="font-medium">{p.label}</span>
                <code className="break-all text-xs text-muted-foreground">{p.path}</code>
                {p.note && <span className="text-destructive">{p.note}</span>}
              </li>
            ))}
          </ul>
          <div>
            <p className="mb-1 font-medium">외장 디스크</p>
            <ul className="space-y-1">
              {env.volumes.map((v) => (
                <li key={v.path} className="flex flex-wrap items-center gap-2">
                  <Ok ok={v.mounted} yes="연결됨" no="분리됨" />
                  <code className="text-xs">{v.path}</code>
                  {v.mounted && (
                    <span className="text-muted-foreground">
                      여유 {gb(v.freeBytes)} / {gb(v.totalBytes)} · UUID {v.volumeUuid ?? "확인 불가"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-muted-foreground">
            앱 데이터(DB) 위치: <code className="text-xs">{env.dataDir}</code>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>한국어 검색 방식 비교</CardTitle>
          <CardDescription>
            {bench
              ? `측정 ${new Date(bench.createdAt).toLocaleString("ko-KR")} · 볼트 노트 ${bench.corpus.vaultRead}개(내려받지 않은 ${bench.corpus.vaultCloudOnly}개 제외) + 검증 샘플 ${bench.corpus.samples}개`
              : "아직 측정 결과가 없습니다. npx tsx scripts/phase0/korean-search-bench.ts 를 실행하세요."}
          </CardDescription>
        </CardHeader>
        {bench && (
          <CardContent className="space-y-6">
            {labels.map((label) => {
              const rs = bench.results.filter((r) => r.label === label);
              return (
                <div key={label} className="overflow-x-auto">
                  <p className="mb-2 text-sm font-medium">
                    {label} ({rs[0].docs.toLocaleString()}개 문서)
                  </p>
                  <table className="w-full min-w-[640px] text-xs">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="py-1 pr-2">검색어</th>
                        <th className="pr-2">정답</th>
                        {rs.map((r) => (
                          <th key={r.method} className="pr-2 font-medium">
                            {r.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rs[0].cases.map((c, i) => (
                        <tr key={c.query} className="border-b">
                          <td className="py-1 pr-2" title={c.expect}>
                            {c.query}
                          </td>
                          <td className="pr-2">{c.gold.toLocaleString()}</td>
                          {rs.map((r) => {
                            const x = r.cases[i];
                            const full = x.recall >= 0.999;
                            return (
                              <td key={r.method} className={full ? "pr-2" : "pr-2 text-destructive"}>
                                {Math.round(x.recall * 100)}% · {x.p95.toFixed(1)}ms
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                      <tr>
                        <td className="py-1 pr-2 font-medium" colSpan={2}>
                          색인 시간 / 크기
                        </td>
                        {rs.map((r) => (
                          <td key={r.method} className="pr-2">
                            {(r.buildMs / 1000).toFixed(1)}s / {(r.sizeBytes / 1048576).toFixed(1)}MB
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              );
            })}
            <p className="text-xs text-muted-foreground">
              값: 찾아야 할 문서 중 찾은 비율 · p95 응답시간. 정답 기준은 &ldquo;검색어의 모든 단어가 제목·본문에 부분 문자열로
              포함&rdquo;(대소문자 무시, 한글 NFC 정규화)입니다.
            </p>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
