"use client";

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { parseOutput, stripAnsi, type Block } from "./parse";

const FILE_LABEL = { add: "➕ 새 파일", update: "✏️ 수정", delete: "🗑️ 삭제" } as const;

function BlockView({ b }: { b: Block }) {
  switch (b.kind) {
    case "answer":
      return (
        <div className="rounded-2xl border bg-card px-4 py-3">
          <div className="prose-hub text-sm [&_p]:my-1.5">
            <Markdown remarkPlugins={[remarkGfm]}>{b.text || "…"}</Markdown>
          </div>
          {b.streaming && <span className="text-xs text-muted-foreground">쓰는 중…</span>}
        </div>
      );
    case "file":
      return (
        <p className="break-all font-mono text-xs">
          {FILE_LABEL[b.action]} {b.path}
        </p>
      );
    case "tool":
      return <p className="break-all text-xs text-muted-foreground">· {b.text}</p>;
    case "error":
      return <p className="whitespace-pre-wrap break-all rounded-lg border border-red-400/60 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-300">{b.text}</p>;
    case "info":
      return <p className="whitespace-pre-wrap text-xs text-muted-foreground">{b.text}</p>;
    case "text":
      return <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 text-xs">{b.text}</pre>;
  }
}

/** AI 답변은 말풍선, 파일 수정은 한 줄, 오류만 빨간색. 원본 기록은 접어 둔다 */
export function OutputView({ provider, output, running, root }: { provider: string; output: string; running: boolean; root?: string }) {
  if (!output) return <p className="text-sm text-muted-foreground">{running ? "시작하는 중…" : "AI 답변, 파일 수정과 검사 결과가 이곳에 표시됩니다."}</p>;
  const blocks = parseOutput(provider, output, running, root);
  return (
    <div aria-live="polite" className="space-y-2">
      {blocks.map((b, i) => (
        <BlockView key={i} b={b} />
      ))}
      {!blocks.length && <p className="text-sm text-muted-foreground">{running ? "작업 중…" : "표시할 내용이 없습니다. 원본 기록을 확인하세요."}</p>}
      {running && blocks.length > 0 && <p className="text-xs text-muted-foreground">작업 중…</p>}
      <details className="pt-1">
        <summary className="cursor-pointer text-xs text-muted-foreground">원본 기록 보기</summary>
        <pre className="mt-2 max-h-[400px] overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 text-[11px]">{stripAnsi(output)}</pre>
      </details>
    </div>
  );
}
