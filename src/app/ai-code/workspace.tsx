"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Project, Run } from "@/server/ai-code/service";

type GitView = { files: { status: string; path: string }[]; diff: string; staged: string; fingerprint: string };
const api = "/api/ai-code";
async function request<T>(query = "", body?: object): Promise<T> {
  const res = await fetch(api + query, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  if (!res.headers.get("content-type")?.includes("application/json")) throw new Error("잠금 해제 또는 서버 접속 상태를 확인하세요.");
  const value = await res.json(); if (!res.ok) throw new Error(value.error ?? "요청 실패"); return value;
}
const control = "rounded-lg border bg-background px-3 py-2 text-sm disabled:opacity-40";
export function CodeWorkspace() {
  const [projects, setProjects] = useState<Project[]>([]), [projectId, setProjectId] = useState("");
  const [provider, setProvider] = useState("codex"), [prompt, setPrompt] = useState("");
  const [runs, setRuns] = useState<Run[]>([]), [run, setRun] = useState<Run | null>(null);
  const [git, setGit] = useState<GitView | null>(null), [message, setMessage] = useState("");
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [pending, setPending] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const stream = useRef<EventSource | null>(null);
  const busy = pending || runs.some(r => r.status === "running") || run?.status === "running";
  const selected = projects.find(p => p.id === projectId);
  const refresh = useCallback(async () => {
    if (!projectId) return;
    const h = await request<Run[]>(`?projectId=${projectId}`); setRuns(h);
    try { setGit(await request<GitView>(`?action=git&projectId=${projectId}`)); } catch (e) { setGit(null); setError(String(e)); }
  }, [projectId]);
  useEffect(() => { request<Project[]>().then(p => { setProjects(p); setProjectId(p[0]?.id ?? ""); }).catch(e => setError(String(e))); }, []);
  useEffect(() => { stream.current?.close(); void Promise.resolve().then(refresh).catch(e => setError(String(e))); return () => stream.current?.close(); }, [refresh]);
  const watch = useCallback((r: Run) => {
    stream.current?.close(); setRun({ ...r, output: "" });
    const source = new EventSource(`${api}?action=stream&id=${r.id}`); stream.current = source;
    source.onmessage = event => {
      const data = JSON.parse(event.data);
      setRun(prev => prev?.id === r.id ? { ...prev, output: prev.output + data.chunk, status: data.status, exitCode: data.exitCode } : prev);
      if (data.status !== "running") { source.close(); void refresh().catch(e => setError(String(e))); }
    };
    source.onerror = () => { source.close(); setError("스트림 연결이 끊겼습니다. 기록에서 작업을 다시 선택하면 재연결됩니다."); void refresh().catch(e => setError(String(e))); };
  }, [refresh]);
  async function act(body: object) {
    setPending(true); setError(""); setNotice("");
    try { const r = await request<Run>("", body); watch(r); setContinuing(false); await refresh(); } catch (e) { setError(String(e)); } finally { setPending(false); }
  }
  async function open(id: string) { try { const r = await request<Run>(`?id=${id}`); if (r.provider !== "check") setProvider(r.provider); watch(r); } catch (e) { setError(String(e)); } }
  return <main className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
    <div><h1 className="text-2xl font-semibold">AI 코드 작업</h1><p className="mt-2 text-sm text-muted-foreground">Mac mini의 Codex · Claude CLI로 등록한 프로젝트를 작업합니다. 셸 실행은 차단되며 검사는 아래 버튼으로 실행합니다.</p></div>
    {error && <p role="alert" className="rounded-lg border border-red-400 p-3 text-sm text-red-600">{error}</p>}
    {notice && <p role="status" className="rounded-lg border p-3 text-sm">{notice}</p>}
    <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
      <aside className="space-y-4 rounded-xl border p-4">
        <label className="block text-sm">프로젝트 폴더<select className={`${control} mt-2 w-full`} value={projectId} disabled={pending} onChange={e => { stream.current?.close(); setProjectId(e.target.value); setRun(null); setGit(null); setContinuing(false); }}>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></label><p className="break-all text-xs text-muted-foreground">{selected?.path}</p>
        <h2 className="font-medium">대화 · 검사 기록</h2>
        <div className="max-h-[600px] space-y-2 overflow-auto">{runs.map(r => <button key={r.id} className={`${control} w-full text-left ${r.id === run?.id ? "border-primary" : ""}`} onClick={() => void open(r.id)}><span className="block truncate">{r.prompt}</span><span className="text-xs text-muted-foreground">{r.provider} · {r.status} · {new Date(r.startedAt).toLocaleString("ko-KR")}</span></button>)}{!runs.length && <p className="text-sm text-muted-foreground">아직 기록이 없습니다.</p>}</div>
      </aside>
      <section className="space-y-4">
        <form className="space-y-3 rounded-xl border p-4" onSubmit={e => { e.preventDefault(); void act({ action: "run", projectId, provider, prompt, ...(continuing && run ? { parentId: run.id } : {}) }); }}>
          <div className="flex flex-wrap items-center gap-3"><label>AI <select className={control} value={provider} disabled={!!busy} onChange={e => { setProvider(e.target.value); setContinuing(false); }}><option value="codex">Codex</option><option value="claude">Claude</option></select></label>
          <label className="text-sm"><input type="checkbox" checked={continuing} disabled={!!busy || !run || run.provider !== provider || run.provider === "check"} onChange={e => setContinuing(e.target.checked)} /> 선택한 대화 이어가기</label></div>
          <label className="block text-sm">프롬프트<textarea className={`${control} mt-2 min-h-32 w-full`} value={prompt} maxLength={16000} required onChange={e => setPrompt(e.target.value)} placeholder="예: 로그인 페이지 오류를 분석하고 수정해줘" /></label>
          <div className="flex flex-wrap gap-2"><button className={`${control} bg-primary text-primary-foreground`} disabled={!!busy || !projectId}>실행</button>
          {run?.status === "running" && <button type="button" className={control} onClick={() => { request("", { action: "stop", id: run.id }).catch(e => setError(String(e))); }}>작업 중단</button>}
          {selected?.checks.map(check => <button type="button" className={control} key={check} disabled={!!busy} onClick={() => void act({ action: "check", projectId, check })}>{check === "test" ? "테스트" : check === "typecheck" ? "타입 검사" : "코드 검사"}</button>)}</div>
        </form>
        <div className="rounded-xl border p-4"><h2 className="mb-2 font-medium">실시간 출력 · 실행 결과 <span className="text-sm text-muted-foreground">{run?.status} {run?.exitCode !== undefined && `· 종료 코드 ${run.exitCode}`}</span></h2><pre aria-live="polite" className="max-h-[500px] min-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 text-xs">{run?.output || "AI 응답, 파일 작업과 검사 결과가 이곳에 표시됩니다."}</pre></div>
        <div className="space-y-3 rounded-xl border p-4"><div className="flex items-center justify-between"><h2 className="font-medium">Git 변경 사항</h2><button className={control} onClick={() => void refresh().catch(e => setError(String(e)))}>새로 확인</button></div>
          <ul className="space-y-1 text-sm">{git?.files.map(f => <li key={f.path} className="break-all font-mono">{f.status} {f.path}</li>)}</ul>
          <details open><summary>작업 폴더 diff</summary><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all bg-muted p-3 text-xs">{git?.diff || "추적 파일 변경 없음 (새 파일 내용은 diff에 포함되지 않습니다)"}</pre></details>
          <details open><summary>커밋할 diff (스테이징 영역)</summary><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all bg-muted p-3 text-xs">{git?.staged || "스테이징된 변경 없음"}</pre></details>
          <p className="text-xs text-muted-foreground">커밋은 터미널에서 미리 스테이징한 변경만 포함합니다. 아래 diff를 확인한 뒤 커밋하세요.</p>
          <form className="flex flex-wrap gap-2" onSubmit={async e => { e.preventDefault(); if (!git) return; setPending(true); setError(""); try { const r = await request<{ output: string }>("", { action: "commit", projectId, message, fingerprint: git.fingerprint }); setNotice(r.output); setMessage(""); await refresh(); } catch (e) { setError(String(e)); } finally { setPending(false); } }}><input aria-label="커밋 메시지" className={`${control} flex-1`} value={message} onChange={e => setMessage(e.target.value)} required maxLength={1000} placeholder="커밋 메시지" /><button className={control} disabled={!!busy || !git?.staged}>Git commit</button></form>
        </div>
      </section>
    </div>
  </main>;
}
