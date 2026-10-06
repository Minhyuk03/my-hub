import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { DATA_DIR } from "@/lib/config";

export type Project = { id: string; name: string; path: string; checks: string[] };
export type Run = { id: string; projectId: string; provider: string; prompt: string; parentId?: string; status: string; startedAt: number; endedAt?: number; exitCode?: number | null; output: string };
const store = () => path.join(DATA_DIR, "ai-code");
const shared = globalThis as typeof globalThis & { hubAiCode?: { active: Map<string, { run: Run; child: ChildProcess; stop: () => void }>; locks: Set<string>; cleanupBound?: boolean } };
const state: NonNullable<typeof shared.hubAiCode> = shared.hubAiCode ??= { active: new Map(), locks: new Set() };
const { active, locks } = state;
const LIMIT = 2 * 1024 * 1024;
const idOK = (s: string) => /^[a-f0-9-]{36}$/.test(s);

export function projects(): Project[] {
  const dirs: string[] = JSON.parse(process.env.HUB_AI_PROJECTS ?? JSON.stringify([path.join(os.homedir(), "code/my-hub")]));
  if (!Array.isArray(dirs) || dirs.some(d => typeof d !== "string" || !path.isAbsolute(d))) throw new Error("HUB_AI_PROJECTS는 절대 경로 JSON 배열이어야 합니다.");
  return dirs.map(d => {
    const p = fs.realpathSync(d);
    if (!fs.statSync(p).isDirectory()) throw new Error("프로젝트 폴더가 아닙니다.");
    return { id: crypto.createHash("sha256").update(p).digest("hex").slice(0, 16), name: path.basename(p), path: p, checks: ["test", "typecheck", "lint"].filter(k => fs.existsSync(checkFile(p, k))) };
  });
}
export function project(id: string) {
  const p = projects().find(p => p.id === id);
  if (!p) throw new Error("등록되지 않은 프로젝트입니다.");
  return p;
}
function checkFile(p: string, kind: string) {
  const files: Record<string, string> = { test: "vitest/vitest.mjs", typecheck: "typescript/bin/tsc", lint: "eslint/bin/eslint.js" };
  if (!files[kind]) throw new Error("허용되지 않은 검사입니다.");
  return path.join(p, "node_modules", files[kind]);
}
function save(run: Run) {
  fs.mkdirSync(store(), { recursive: true, mode: 0o700 });
  const file = path.join(store(), `${run.id}.json`);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(run), { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}
export function getRun(id: string): Run {
  if (!idOK(id)) throw new Error("잘못된 작업 ID입니다.");
  const running = active.get(id);
  if (running) return running.run;
  const r: Run = JSON.parse(fs.readFileSync(path.join(store(), `${id}.json`), "utf8"));
  if (r.status === "running") { r.status = "interrupted"; r.endedAt = Date.now(); save(r); }
  return r;
}
export function history(projectId: string) {
  project(projectId);
  if (!fs.existsSync(store())) return [];
  return fs.readdirSync(store()).filter(f => /^[a-f0-9-]{36}\.json$/.test(f)).map(f => getRun(f.slice(0, -5))).filter(r => r.projectId === projectId).sort((a, b) => b.startedAt - a.startedAt).slice(0, 100).map(r => ({ ...r, output: undefined }));
}
export function stopRun(id: string) {
  const a = active.get(id);
  if (!a) throw new Error("실행 중인 작업이 아닙니다.");
  a.stop();
}
function kill(child: ChildProcess, signal: NodeJS.Signals) {
  if (child.pid) { try { process.kill(-child.pid, signal); } catch { child.kill(signal); } }
}
if (!state.cleanupBound) {
  state.cleanupBound = true;
  const cleanup = () => {
    for (const { child, run } of active.values()) {
      kill(child, "SIGKILL");
      run.status = "interrupted"; run.endedAt = Date.now();
      try { save(run); } catch { /* The last checkpoint remains available. */ }
    }
  };
  process.once("exit", cleanup);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const existingHandler = process.listenerCount(signal) > 0;
    process.once(signal, () => { cleanup(); if (!existingHandler) process.exit(signal === "SIGINT" ? 130 : 143); });
  }
}
function cliEnv() {
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV, GIT_TERMINAL_PROMPT: "0" };
  for (const key of ["HOME", "USER", "LOGNAME", "PATH", "TMPDIR", "LANG", "LC_ALL", "TERM", "CODEX_HOME", "CLAUDE_CONFIG_DIR", "OPENAI_API_KEY", "CODEX_API_KEY", "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}
export function cliBinary(provider: string) {
  if (provider !== "codex" && provider !== "claude") throw new Error("허용되지 않은 AI입니다.");
  const override = process.env[provider === "codex" ? "HUB_CODEX_BIN" : "HUB_CLAUDE_BIN"];
  if (override) return override;
  for (const dir of [path.join(os.homedir(), ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin"]) {
    const file = path.join(dir, provider);
    try { fs.accessSync(file, fs.constants.X_OK); return file; } catch { /* Try the next known installation directory. */ }
  }
  return provider;
}
// Only fixed executables/argv reach spawn. Never use a shell, eval, or package scripts.
export function agentArgs(provider: string): string[] {
  if (provider === "claude") return ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--restricted", "--safe-mode", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--tools", "Read,Edit,Write,Glob,Grep", "--allowedTools", "Read,Edit,Write,Glob,Grep", "--permission-mode", "acceptEdits", "--permission-prompts", "none", "--disable-slash-commands"];
  if (provider !== "codex") throw new Error("허용되지 않은 AI입니다.");
  return ["exec", "--json", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--sandbox", "workspace-write", "-c", 'approval_policy="never"', "-c", 'web_search="disabled"', ...["shell_tool", "unified_exec", "code_mode", "code_mode_host", "hooks", "plugins", "remote_plugin", "apps", "multi_agent", "browser_use", "computer_use", "skill_mcp_dependency_install"].flatMap(f => ["--disable", f]), "-"];
}
function noProjectCodexConfig(p: string) {
  // Project/ancestor configs can introduce arbitrary MCP executables, so fail closed.
  for (let dir = p; ; dir = path.dirname(dir)) {
    if (path.join(dir, ".codex") !== (process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex")) && fs.existsSync(path.join(dir, ".codex/config.toml"))) throw new Error("Codex 안전 실행: 프로젝트/상위 폴더의 .codex/config.toml을 제거하거나 별도 프로젝트를 등록하세요.");
    if (dir === path.dirname(dir)) break;
  }
}
export function startRun(input: { projectId: string; provider: string; prompt?: string; parentId?: string; check?: string }): Run {
  const p = project(input.projectId);
  if (locks.has(p.id)) throw new Error("이 프로젝트에 실행 중인 작업이 있습니다.");
  let args: string[], command: string, prompt = input.prompt ?? "";
  if (input.check) {
    if (!p.checks.includes(input.check)) throw new Error("이 프로젝트에 허용된 검사 도구가 없습니다.");
    command = process.execPath;
    args = [checkFile(p.path, input.check), ...(input.check === "test" ? ["run"] : input.check === "typecheck" ? ["--noEmit", "--incremental", "false"] : [])];
    prompt = input.check;
  } else {
    if (!prompt.trim() || prompt.length > 16000) throw new Error("프롬프트는 1~16000자로 입력하세요.");
    args = agentArgs(input.provider);
    if (input.provider === "codex") noProjectCodexConfig(p.path);
    command = cliBinary(input.provider);
  }
  let context = "";
  if (input.parentId) {
    const previous = getRun(input.parentId);
    if (previous.projectId !== p.id || previous.provider !== input.provider || previous.status === "running") throw new Error("이어갈 대화가 일치하지 않습니다.");
    context = `Previous request:\n${previous.prompt}\nPrevious output:\n${previous.output.slice(-24000)}\n\n`;
  }
  const run: Run = { id: crypto.randomUUID(), projectId: p.id, provider: input.check ? "check" : input.provider, prompt, parentId: input.parentId, startedAt: Date.now(), status: "running", output: "" };
  locks.add(p.id);
  try { save(run); } catch (e) { locks.delete(p.id); throw e; }
  let child: ChildProcess;
  try { child = spawn(command, args, { cwd: p.path, shell: false, detached: true, stdio: ["pipe", "pipe", "pipe"], env: cliEnv() }); }
  catch (e) { locks.delete(p.id); run.status = "failed"; save(run); throw e; }
  let stopped = false, finished = false, bytes = 0;
  const terminate = () => {
    stopped = true; kill(child, "SIGTERM");
    setTimeout(() => kill(child, "SIGKILL"), 3000).unref();
  };
  active.set(run.id, { run, child, stop: terminate });
  const timer = setTimeout(terminate, 20 * 60_000); timer.unref();
  const checkpoint = setInterval(() => { try { save(run); } catch { terminate(); } }, 1000); checkpoint.unref();
  const append = (s: string) => {
    bytes += Buffer.byteLength(s);
    if (bytes > LIMIT) { if (!stopped) { run.output += "\n[출력 제한 초과: 중단]\n"; terminate(); } return; }
    run.output += s;
  };
  child.stdout!.setEncoding("utf8"); child.stderr!.setEncoding("utf8");
  child.stdout!.on("data", append); child.stderr!.on("data", s => append(`[stderr] ${s}`));
  child.stdin!.on("error", () => {});
  const finish = (code: number | null, error?: Error) => {
    if (finished) return; finished = true;
    clearTimeout(timer); clearInterval(checkpoint);
    if (error) append(`\n${error.message}\n`);
    run.status = stopped ? "stopped" : error || code !== 0 ? "failed" : "completed";
    run.exitCode = code; run.endedAt = Date.now();
    active.delete(run.id); locks.delete(p.id); save(run);
  };
  child.on("error", e => finish(null, e)); child.on("close", code => finish(code));
  child.stdin!.end(input.check ? "" : `${context}Do not execute shell commands. Edit files using file tools. Tests and Git commits are handled by My Hub buttons.\n\n${prompt}`);
  return run;
}
const gitPrefix = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "diff.external=", "-c", "core.pager=cat"];
async function git(p: Project, args: string[]) {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn("/usr/bin/git", [...gitPrefix, ...args], { cwd: p.path, shell: false, env: { ...cliEnv(), GIT_OPTIONAL_LOCKS: "0", GIT_EXTERNAL_DIFF: "" } });
    let out = "", err = "", size = 0;
    const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", s => { size += Buffer.byteLength(s); if (size > LIMIT) child.kill("SIGKILL"); else out += s; });
    child.stderr.on("data", s => { err = (err + s).slice(-8000); });
    child.on("error", e => { clearTimeout(timer); reject(e); });
    child.on("close", code => { clearTimeout(timer); if (code === 0) resolve(out); else reject(new Error(err || "Git 작업 실패 또는 출력 제한 초과")); });
  });
}
export async function gitView(projectId: string) {
  const p = project(projectId);
  if ((await git(p, ["rev-parse", "--show-toplevel"])).trim() !== p.path) throw new Error("등록 폴더는 Git 저장소 루트여야 합니다.");
  const status = await git(p, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const tokens = status.split("\0"); const files: { status: string; path: string }[] = [];
  for (let i = 0; i < tokens.length; i++) { const t = tokens[i]; if (!t) continue; files.push({ status: t.slice(0, 2), path: t.slice(3) }); if (/[RC]/.test(t.slice(0, 2))) i++; }
  const diff = await git(p, ["diff", "--binary", "--no-ext-diff", "--no-textconv", "--", "."]);
  const staged = await git(p, ["diff", "--cached", "--binary", "--no-ext-diff", "--no-textconv", "--", "."]);
  return { files, diff, staged, fingerprint: crypto.createHash("sha256").update(status + diff + staged).digest("hex") };
}
export async function commit(projectId: string, message: string, fingerprint: string) {
  const p = project(projectId);
  if (locks.has(p.id)) throw new Error("진행 중인 작업을 먼저 끝내세요.");
  if (!message.trim() || message.length > 1000) throw new Error("커밋 메시지는 1~1000자입니다.");
  locks.add(p.id);
  try {
    const view = await gitView(p.id);
    if (!view.staged || view.fingerprint !== fingerprint) throw new Error("스테이징된 변경이 없거나 변경 내용이 바뀌었습니다. 새로 확인하세요.");
    // Commit only the explicitly reviewed index. Never git add -A or include untracked secrets.
    return await git(p, ["-c", "commit.gpgsign=false", "commit", "-m", message]);
  } finally { locks.delete(p.id); }
}
