"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { deleteThreadAction } from "./actions";

type Provider = "local" | "claude" | "openai";
export type ProviderInfo = { id: Provider; label: string; model: string; ready: boolean; note: string };
type Citation = { n: number; itemId: number; title: string; path: string; quote: string; cited: boolean };
type Msg = {
  id: number;
  role: "user" | "assistant";
  content: string;
  provider: string | null;
  model: string | null;
  localOnly: boolean;
  insufficient: boolean;
  excludedCount: number;
  error: string | null;
  citations: Citation[];
};
type Scope = { kind: "all" } | { kind: "project"; projectId: number } | { kind: "items"; itemIds: number[] };

const PROVIDER_LABEL: Record<string, string> = { local: "로컬 AI", claude: "Claude", openai: "ChatGPT" };

/** 답변 본문: [1] 같은 출처 번호를 누를 수 있는 작은 칩으로 */
function Answer({ text, citations }: { text: string; citations: Citation[] }) {
  const byN = new Map(citations.map((c) => [c.n, c]));
  const md = text.replace(/\[(\d+(?:\s*[,，]\s*\d+)*)\]/g, (_, g: string) =>
    g
      .split(/[,，]/)
      .map((x) => `[${x.trim()}](#cite-${x.trim()})`)
      .join(""),
  );
  return (
    <div className="prose-hub text-sm [&_p]:my-1.5">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const m = href?.match(/^#cite-(\d+)$/);
            if (!m) return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
            const c = byN.get(Number(m[1]));
            return (
              <Link
                href={c ? `/items/${c.itemId}` : "#"}
                title={c ? `${c.title} — ${c.path}` : "출처 없음"}
                className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-primary/15 px-1 align-super text-[10px] font-semibold text-primary no-underline"
              >
                {m[1]}
              </Link>
            );
          },
        }}
      >
        {md}
      </Markdown>
    </div>
  );
}

function Sources({ citations, pending }: { citations: Citation[]; pending?: boolean }) {
  if (!citations.length) return null;
  if (pending) return <p className="mt-2 text-xs text-muted-foreground">자료 {citations.length}개: {citations.map((c) => c.title).join(", ")}</p>;
  const sorted = [...citations].sort((a, b) => Number(b.cited) - Number(a.cited) || a.n - b.n);
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-muted-foreground">
        출처 {citations.filter((c) => c.cited).length}개 인용 · 자료 {citations.length}개 (답할 때의 원문 보기)
      </summary>
      <ul className="mt-2 space-y-2">
        {sorted.map((c) => (
          <li key={c.n} className={`rounded border p-2 ${c.cited ? "" : "opacity-60"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-primary/15 px-1 font-semibold text-primary">{c.n}</span>
              <Link href={`/items/${c.itemId}`} className="font-medium hover:underline">
                {c.title}
              </Link>
              <span className="truncate text-muted-foreground">{c.path}</span>
              {!c.cited && <span className="text-muted-foreground">(인용 안 됨)</span>}
            </div>
            <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-muted-foreground">{c.quote}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}

function MessageView({ m }: { m: Msg }) {
  if (m.role === "user") return <div className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl bg-primary px-4 py-2 text-sm text-primary-foreground">{m.content}</div>;
  return (
    <div className="max-w-full rounded-2xl border bg-card px-4 py-3">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          {PROVIDER_LABEL[m.provider ?? ""] ?? m.provider} {m.model && <span className="opacity-70">· {m.model}</span>}
        </span>
        {m.localOnly && <span title="외부 전송 금지 자료를 썼습니다. 이 답은 Claude·ChatGPT 로 보내지 않습니다.">🔒 로컬 전용</span>}
        {m.excludedCount > 0 && <span>🔒 외부 금지 자료 {m.excludedCount}개 빼고 보냄</span>}
      </div>
      {m.content && <Answer text={m.content} citations={m.citations} />}
      {m.error && <p className="text-sm text-destructive">{m.error}</p>}
      <Sources citations={m.citations} pending={m.id === 0} />
    </div>
  );
}

export function ChatClient({
  thread,
  scope: initialScope,
  scopeLabel,
  projects,
  providers,
  quickActions,
}: {
  thread: { id: number; title: string; messages: Msg[] } | null;
  scope: Scope;
  scopeLabel: { label: string; items?: { id: number; title: string }[] };
  projects: { id: number; name: string }[];
  providers: ProviderInfo[];
  quickActions: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [scope, setScope] = useState<Scope>(initialScope);
  const [provider, setProvider] = useState<Provider>(() => providers.find((x) => x.ready)?.id ?? "local");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ question: string; msg: Msg } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const p = localStorage.getItem("hub.chat.provider") as Provider | null;
      // 브라우저에 기억한 선택은 화면이 뜬 뒤에만 읽을 수 있다 (서버 렌더링과 맞추기 위해)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (p && providers.some((x) => x.id === p && x.ready)) setProvider(p);
    } catch {}
  }, [providers]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [pending?.msg.content, thread?.messages.length]);

  // 로컬 모델 미리 불러오기
  useEffect(() => {
    if (provider === "local" && providers.find((p) => p.id === "local")?.ready) void fetch("/api/chat/warm", { method: "POST" }).catch(() => {});
  }, [provider, providers]);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!busy) return;
    const t = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(t);
  }, [busy]);

  const choose = (p: Provider) => {
    setProvider(p);
    try {
      localStorage.setItem("hub.chat.provider", p);
    } catch {}
  };

  async function send(question: string, action?: string) {
    if (busy || (!question.trim() && !action)) return;
    setBusy(true);
    setSlow(false);
    const shown = question.trim() || quickActions.find((a) => a.id === action)?.label || "";
    const msg: Msg = { id: 0, role: "assistant", content: "", provider, model: null, localOnly: false, insufficient: false, excludedCount: 0, error: null, citations: [] };
    setPending({ question: shown, msg });
    setQ("");
    const ctrl = new AbortController();
    abort.current = ctrl;
    let threadId = thread?.id;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId, scope, question, provider, action }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).message ?? `오류 ${res.status}`);
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (!line) continue;
          const e = JSON.parse(line);
          if (e.type === "start") {
            threadId = e.threadId;
            msg.localOnly = e.localOnly;
            msg.excludedCount = e.excluded;
            msg.citations = e.contexts.map((c: Citation) => ({ ...c, quote: "", cited: true }));
          } else if (e.type === "delta") msg.content += e.text;
          else if (e.type === "error") msg.error = e.message;
          setPending({ question: shown, msg: { ...msg } });
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") msg.error = (e as Error).message;
      setPending({ question: shown, msg: { ...msg } });
    } finally {
      setBusy(false);
      abort.current = null;
    }
    if (threadId && threadId !== thread?.id) router.push(`/chat?t=${threadId}`);
    else router.refresh();
    setPending(null);
  }

  const cur = providers.find((p) => p.id === provider);
  return (
    <div className="flex min-h-[70vh] flex-col gap-3">
      {/* 범위 */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">범위</span>
        {thread ? (
          <span className="rounded bg-muted px-2 py-0.5">{scopeLabel.label}</span>
        ) : (
          <select
            className="h-8 rounded-md border bg-background px-2"
            value={scope.kind === "project" ? `p${scope.projectId}` : scope.kind}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "all") setScope({ kind: "all" });
              else if (v === "items") setScope(initialScope);
              else setScope({ kind: "project", projectId: Number(v.slice(1)) });
            }}
          >
            <option value="all">허브 전체</option>
            {initialScope.kind === "items" && <option value="items">{scopeLabel.label}</option>}
            {projects.map((p) => (
              <option key={p.id} value={`p${p.id}`}>
                프로젝트: {p.name}
              </option>
            ))}
          </select>
        )}
        {scope.kind === "items" &&
          scopeLabel.items?.map((it) => (
            <Link key={it.id} href={`/items/${it.id}`} className="max-w-48 truncate rounded border px-2 py-0.5 text-xs hover:bg-muted">
              {it.title}
            </Link>
          ))}
        {thread && (
          <form action={deleteThreadAction.bind(null, thread.id)} className="ml-auto">
            <button className="text-xs text-muted-foreground hover:text-destructive" onClick={(e) => !confirm("이 대화를 지울까요? (허브의 대화 기록만 지워집니다)") && e.preventDefault()}>
              대화 지우기
            </button>
          </form>
        )}
      </div>

      {/* 메시지 */}
      <div className="flex-1 space-y-3">
        {!thread && !pending && (
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            허브에 있는 내 자료를 찾아 근거로 답합니다. 답마다 출처 번호가 붙고, 답할 때 쓴 원문도 함께 저장됩니다.
            <br />
            Claude·ChatGPT 를 고르면 🔒 외부 전송 금지 자료는 서버가 빼고 보내며, 보낸 내용은{" "}
            <Link href="/chat/log" className="underline">
              외부 전송 내역
            </Link>
            에 남습니다.
          </div>
        )}
        {thread?.messages.map((m) => (
          <div key={m.id} className="flex">
            <MessageView m={m} />
          </div>
        ))}
        {pending && (
          <>
            <div className="flex">
              <MessageView m={{ id: -1, role: "user", content: pending.question, provider: null, model: null, localOnly: false, insufficient: false, excludedCount: 0, error: null, citations: [] }} />
            </div>
            <div className="flex">
              <div className="w-full">
                <MessageView m={pending.msg} />
                {busy && !pending.msg.content && !pending.msg.error && (
                  <p className="mt-1 text-xs text-muted-foreground">{pending.msg.citations.length ? `자료 ${pending.msg.citations.length}개를 읽고 답을 쓰는 중…` : "자료를 찾는 중…"}
                    {slow && provider === "local" && " (모델을 처음 불러올 때는 1분 정도 걸립니다)"}</p>
                )}
              </div>
            </div>
          </>
        )}
        <div ref={bottom} />
      </div>

      {/* 입력 */}
      <div className="sticky bottom-0 space-y-2 border-t bg-background/95 pt-3 pb-2 backdrop-blur">
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          {providers.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={!p.ready}
              onClick={() => choose(p.id)}
              title={p.note}
              className={`rounded-full border px-3 py-1 ${provider === p.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"} disabled:cursor-not-allowed disabled:opacity-40`}
            >
              {p.label}
            </button>
          ))}
          <span className="text-xs text-muted-foreground">{cur?.note}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {quickActions
            .filter((a) => (a.id === "status" ? scope.kind === "project" : a.id === "summary" ? scope.kind !== "all" : true))
            .map((a) => (
              <Button key={a.id} type="button" size="sm" variant="outline" title={scope.kind === "all" ? "허브 전체에서 최근 수정한 자료로" : undefined} disabled={busy || !cur?.ready} onClick={() => send("", a.id)}>
                {a.label}
              </Button>
            ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(q);
          }}
        >
          <textarea
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(q);
              }
            }}
            rows={2}
            placeholder="질문을 입력하세요 (Shift+Enter 줄바꿈)"
            className="min-h-11 flex-1 resize-y rounded-md border bg-background px-3 py-2 text-sm"
          />
          {busy ? (
            <Button type="button" variant="outline" onClick={() => abort.current?.abort()}>
              멈춤
            </Button>
          ) : (
            <Button type="submit" disabled={!q.trim() || !cur?.ready}>
              보내기
            </Button>
          )}
        </form>
      </div>
    </div>
  );
}
