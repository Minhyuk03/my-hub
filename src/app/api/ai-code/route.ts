import { projects, history, getRun, startRun, stopRun, gitView, commit } from "@/server/ai-code/service";
import { LISTENER_HEADER } from "@/server/http/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Mac mini 본인 접속과 Tailscale 접속(허용 계정 + 앱 패스코드, server.ts 에서 확인) 모두 쓸 수 있다
const fail = (e: unknown) => json({ error: e instanceof Error ? e.message : "요청 실패" }, 400);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
function trusted(req: Request, write = false) {
  // This header is injected only after server.ts authentication; direct next dev is unsupported.
  if (!["local", "tailscale"].includes(req.headers.get(LISTENER_HEADER) ?? "")) throw new Error("My Hub 사용자 정의 서버로 접속하세요.");
  if (write) {
    const origin = req.headers.get("origin");
    if (!origin || new URL(origin).host !== req.headers.get("host")) throw new Error("같은 출처 요청만 허용됩니다.");
    if (!req.headers.get("content-type")?.startsWith("application/json")) throw new Error("JSON 요청만 허용됩니다.");
  }
}
export async function GET(req: Request) {
  try {
    trusted(req);
    const q = new URL(req.url).searchParams;
    if (q.get("action") === "stream") {
      const id = q.get("id") ?? ""; getRun(id);
      let timer: ReturnType<typeof setInterval> | undefined;
      const encoder = new TextEncoder(); let cursor = 0;
      const stream = new ReadableStream({
        start(controller) {
          const tick = () => {
            try {
              const r = getRun(id);
              const chunk = r.output.slice(cursor); cursor = r.output.length;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk, status: r.status, exitCode: r.exitCode })}\n\n`));
              if (r.status !== "running") { clearInterval(timer); controller.close(); }
            } catch { clearInterval(timer); controller.close(); }
          };
          timer = setInterval(tick, 300); tick();
        },
        cancel() { clearInterval(timer); },
      });
      return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
    }
    if (q.get("id")) return json(getRun(q.get("id")!));
    if (q.get("action") === "git") return json(await gitView(q.get("projectId") ?? ""));
    if (q.get("projectId")) return json(history(q.get("projectId")!));
    return json(projects());
  } catch (e) { return fail(e); }
}
export async function POST(req: Request) {
  try {
    trusted(req, true);
    const reader = req.body?.getReader(); if (!reader) throw new Error("빈 요청입니다.");
    let body = "", bytes = 0; const decoder = new TextDecoder();
    while (true) { const r = await reader.read(); if (r.done) break; bytes += r.value.byteLength; if (bytes > 70000) { await reader.cancel(); throw new Error("요청이 너무 큽니다."); } body += decoder.decode(r.value, { stream: true }); }
    body += decoder.decode();
    const b = JSON.parse(body);
    for (const key of ["action", "id", "projectId", "provider", "prompt", "parentId", "check", "message", "fingerprint"]) if (b[key] !== undefined && typeof b[key] !== "string") throw new Error("입력 형식이 잘못되었습니다.");
    if (b.action === "stop") { stopRun(b.id); return json({ ok: true }); }
    if (b.action === "commit") return json({ output: await commit(b.projectId, b.message ?? "", b.fingerprint ?? "") });
    if (b.action === "run") return json(startRun({ projectId: b.projectId, provider: b.provider, prompt: b.prompt, parentId: b.parentId }), 201);
    if (b.action === "check") return json(startRun({ projectId: b.projectId, provider: "check", check: b.check }), 201);
    throw new Error("허용되지 않은 작업입니다.");
  } catch (e) { return fail(e); }
}
