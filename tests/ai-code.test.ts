import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
const tmp = vi.hoisted(() => ({ dir: "" }));
vi.mock("@/lib/config", () => ({ get DATA_DIR() { return tmp.dir; } }));
import { projects, project, cliBinary, agentArgs, startRun, getRun, stopRun, history, gitView, commit } from "@/server/ai-code/service";
import { GET, POST } from "@/app/api/ai-code/route";
let root: string, repo: string, pid: string;
const previous = { projects: process.env.HUB_AI_PROJECTS, codex: process.env.HUB_CODEX_BIN, path: process.env.PATH };
const git = (...args: string[]) => execFileSync("/usr/bin/git", args, { cwd: repo, encoding: "utf8" });
async function finished(id: string) { for (let i = 0; i < 100; i++) { const r = getRun(id); if (r.status !== "running") return r; await new Promise(r => setTimeout(r, 30)); } throw new Error("timeout"); }
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hub-ai-test-")); tmp.dir = path.join(root, "data"); repo = path.join(root, "repo"); fs.mkdirSync(repo);
  process.env.PATH = path.dirname(process.execPath) + path.delimiter + (previous.path ?? "");
  process.env.HUB_AI_PROJECTS = JSON.stringify([repo]); pid = projects()[0].id;
  git("init", "-q"); git("config", "user.email", "test@example.invalid"); git("config", "user.name", "Test");
  fs.writeFileSync(path.join(repo, "file.txt"), "before\n"); git("add", "file.txt"); git("commit", "-qm", "initial");
  const fake = path.join(root, "fake-codex");
  fs.writeFileSync(fake, `#!/usr/bin/env node\nlet input='';process.stdin.on('data',s=>input+=s);process.stdin.on('end',()=>{console.log(JSON.stringify({text:input}));if(input.includes('WAIT'))setTimeout(()=>{},10000);});\n`, { mode: 0o700 });
  process.env.HUB_CODEX_BIN = fake;
});
afterAll(() => { if (previous.path === undefined) delete process.env.PATH; else process.env.PATH = previous.path; if (previous.projects === undefined) delete process.env.HUB_AI_PROJECTS; else process.env.HUB_AI_PROJECTS = previous.projects; if (previous.codex === undefined) delete process.env.HUB_CODEX_BIN; else process.env.HUB_CODEX_BIN = previous.codex; fs.rmSync(root, { recursive: true, force: true }); });
describe("AI CLI security and lifecycle", () => {
  it("rejects arbitrary providers, folders and test commands", () => {
    expect(() => project("../../etc")).toThrow(); expect(() => agentArgs("bash")).toThrow();
    expect(() => startRun({ projectId: pid, provider: "codex", check: "test; touch /tmp/pwn" })).toThrow();
    expect(() => getRun("../../secret")).toThrow();
  });
  it("resolves installed CLIs independently of the service PATH", () => {
    const old = process.env.HUB_CODEX_BIN;
    delete process.env.HUB_CODEX_BIN;
    const installed = path.join(os.homedir(), ".local/bin/codex");
    const access = vi.spyOn(fs, "accessSync").mockImplementation(file => { if (file !== installed) throw new Error("missing"); });
    try { expect(cliBinary("codex")).toBe(installed); }
    finally { access.mockRestore(); process.env.HUB_CODEX_BIN = old; }
    expect(cliBinary("codex")).toBe(old);
    expect(() => cliBinary("bash")).toThrow();
  });
  it("disables command tools and external customizations", () => {
    const a = agentArgs("codex").join(" "); expect(a).toContain("--disable shell_tool"); expect(a).toContain("--disable unified_exec"); expect(a).toContain("--disable hooks"); expect(a).toContain("--ignore-user-config");
    const c = agentArgs("claude"); expect(c).toContain("--restricted"); expect(c).toContain("--safe-mode"); expect(c[c.indexOf("--tools") + 1]).not.toContain("Bash");
  });
  it("refuses project Codex MCP configuration", () => {
    fs.mkdirSync(path.join(repo, ".codex")); fs.writeFileSync(path.join(repo, ".codex/config.toml"), "");
    expect(() => startRun({ projectId: pid, provider: "codex", prompt: "hello" })).toThrow(/config.toml/);
    fs.rmSync(path.join(repo, ".codex"), { recursive: true });
  });
  it("passes shell metacharacters literally, persists and reuses conversation context", async () => {
    const marker = path.join(root, "pwn"); const prompt = `hello; touch ${marker} $(touch ${marker})`;
    const r = await finished(startRun({ projectId: pid, provider: "codex", prompt }).id);
    expect(r.status).toBe("completed"); expect(r.exitCode).toBe(0); expect(r.output).toContain(prompt); expect(fs.existsSync(marker)).toBe(false);
    const next = await finished(startRun({ projectId: pid, provider: "codex", prompt: "continue", parentId: r.id }).id);
    expect(next.output).toContain("Previous request"); expect(history(pid)).toHaveLength(2);
  });
  it("locks concurrent project jobs and stops the running process", async () => {
    const r = startRun({ projectId: pid, provider: "codex", prompt: "WAIT" });
    expect(() => startRun({ projectId: pid, provider: "codex", prompt: "second" })).toThrow(/실행 중/);
    stopRun(r.id); expect((await finished(r.id)).status).toBe("stopped");
  });
  it("reports tracked, untracked and staged changes; commits only reviewed index", async () => {
    fs.writeFileSync(path.join(repo, "file.txt"), "after\n"); fs.writeFileSync(path.join(repo, "secret.env"), "do not include");
    let view = await gitView(pid); expect(view.files.map(f => f.path)).toContain("secret.env"); expect(view.diff).toContain("+after");
    await expect(commit(pid, "msg", view.fingerprint)).rejects.toThrow();
    git("add", "file.txt"); view = await gitView(pid);
    await expect(commit(pid, "msg", "stale")).rejects.toThrow();
    await commit(pid, "reviewed", view.fingerprint); expect(git("show", "--format=", "--name-only", "HEAD").trim()).toBe("file.txt");
    expect(git("status", "--porcelain")).toContain("secret.env");
  });
  it("replays completed output over SSE and closes the stream", async () => {
    const r = await finished(startRun({ projectId: pid, provider: "codex", prompt: "stream test" }).id);
    const response = await GET(new Request(`http://localhost:3000/api/ai-code?action=stream&id=${r.id}`, { headers: { host: "localhost:3000", "x-hub-listener": "local" } }));
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const event = await response.text(); expect(event).toContain("stream test"); expect(event).toContain('"status":"completed"');
  });
  it("marks an orphaned running record as interrupted", () => {
    const id = "12345678-1234-1234-1234-123456789012";
    fs.writeFileSync(path.join(tmp.dir, "ai-code", `${id}.json`), JSON.stringify({ id, projectId: pid, provider: "codex", prompt: "orphan", startedAt: 0, status: "running", output: "checkpoint" }));
    expect(getRun(id).status).toBe("interrupted"); expect(getRun(id).output).toBe("checkpoint");
  });
  it("blocks missing trusted server header, missing Origin and foreign Origin", async () => {
    expect((await GET(new Request("http://localhost:3000/api/ai-code"))).status).toBe(400);
    for (const origin of [undefined, "https://evil.example"]) {
      const headers: Record<string, string> = { host: "localhost:3000", "x-hub-listener": "local", "content-type": "application/json" }; if (origin) headers.origin = origin;
      expect((await POST(new Request("http://localhost:3000/api/ai-code", { method: "POST", headers, body: '{"action":"run"}' }))).status).toBe(400);
    }
  });
  it("works over the authenticated Tailscale listener as well as locally", async () => {
    const ts = { host: "mh-macmini-1.example.ts.net", "x-hub-listener": "tailscale", "tailscale-user-login": "me@example.com" };
    expect((await GET(new Request("https://mh-macmini-1.example.ts.net/api/ai-code", { headers: ts }))).status).toBe(200);
    expect((await GET(new Request("http://localhost:3000/api/ai-code", { headers: { host: "localhost:3000", "x-hub-listener": "local" } }))).status).toBe(200);
    // 다른 출처에서 온 쓰기 요청은 Tailscale 이어도 막는다
    const post = await POST(
      new Request("https://mh-macmini-1.example.ts.net/api/ai-code", {
        method: "POST",
        headers: { ...ts, origin: "https://evil.example", "content-type": "application/json" },
        body: '{"action":"run"}',
      }),
    );
    expect(post.status).toBe(400);
  });
});
