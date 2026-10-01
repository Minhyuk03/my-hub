/**
 * 허브 웹 서버 (Next.js 사용자 정의 서버)
 *   127.0.0.1:3000  Mac mini 본인 접속
 *   127.0.0.1:3001  tailscale serve 전용 (https://<기기>.ts.net → 여기로 전달)
 * 두 포트 모두 127.0.0.1 에만 바인딩한다. 공용 인터넷에 포트를 열지 않는다.
 * 인증 규칙은 src/server/http/auth.ts (자동 테스트: tests/auth.test.ts)
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import next from "next";
import { DATA_DIR } from "@/lib/config";
import { openDb } from "@/server/db";
import { AttemptLimiter, createSession, decide, sanitizeHeaders, securityHeaders, sessionCookie, verifyPasscode, type AuthConfig, type Listener } from "@/server/http/auth";
import { TAILSCALE_HOST } from "@/server/http/local";
import { getSettings } from "@/server/settings";

const dev = process.env.NODE_ENV !== "production";
const LOCAL_PORT = Number(process.env.HUB_PORT ?? 3000);
const TS_PORT = Number(process.env.HUB_TS_PORT ?? 3001);

/** 세션 서명 키: 처음 실행 때 만들어 권한 600 으로 보관 */
function sessionSecret(): string {
  const f = path.join(DATA_DIR, "session-secret");
  if (!fs.existsSync(f)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(f, crypto.randomBytes(32).toString("base64url"), { mode: 0o600 });
  }
  return fs.readFileSync(f, "utf8").trim();
}

const secret = sessionSecret();
const db = openDb(undefined, { migrate: false });
let cfgCache: { at: number; cfg: AuthConfig } | null = null;
function authConfig(): AuthConfig {
  if (!cfgCache || Date.now() - cfgCache.at > 5000) {
    const s = getSettings(db);
    cfgCache = { at: Date.now(), cfg: { allowedLogins: s.allowedTailscaleLogins, passcodeHash: s.passcodeHash, secret, requireLocalPasscode: s.requireLocalPasscode } };
  }
  return cfgCache.cfg;
}
const limiter = new AttemptLimiter();

function unlockPage(res: http.ServerResponse, message = "", nextPath = "/") {
  res.writeHead(message ? 401 : 200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    // 잠금 화면은 스크립트가 없다
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  });
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  res.end(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>나의 허브 잠금 해제</title>
<style>body{font-family:-apple-system,"Apple SD Gothic Neo",sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#fff;color:#171717}
@media(prefers-color-scheme:dark){body{background:#0a0a0a;color:#ededed}input{background:#171717;color:#ededed}}
form{display:grid;gap:12px;width:min(320px,90vw)}input,button{font-size:17px;padding:12px;border-radius:8px;border:1px solid #8884}
button{background:#171717;color:#fff;border:0}@media(prefers-color-scheme:dark){button{background:#ededed;color:#171717}}p{margin:0;color:#d33}</style></head>
<body><form method="post" action="/unlock"><h1 style="margin:0;font-size:20px">나의 허브</h1>
<input type="password" name="passcode" placeholder="앱 패스코드" autocomplete="current-password" autofocus required>
<input type="hidden" name="next" value="${esc(nextPath)}">${message ? `<p>${esc(message)}</p>` : ""}<button type="submit">잠금 해제</button></form></body></html>`);
}

function readBody(req: http.IncomingMessage, limit = 4096): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > limit) reject(new Error("too large"));
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function main() {
  const app = next({ dev, hostname: "127.0.0.1", port: LOCAL_PORT });
  const handle = app.getRequestHandler();
  await app.prepare();

  const make = (listener: Listener) =>
    http.createServer(async (req, res) => {
      sanitizeHeaders(req.headers, listener);
      const url = new URL(req.url ?? "/", "http://x");
      for (const [k, v] of Object.entries(securityHeaders(url.pathname))) res.setHeader(k, v);
      const d = decide(listener, req.headers, url.pathname, authConfig());
      if (d.action === "deny") {
        res.writeHead(d.status, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(d.message);
        return;
      }
      if (d.action === "unlock") {
        if (url.pathname === "/unlock" && req.method === "POST") {
          const origin = req.headers.origin;
          const okOrigins = listener === "local" ? [`http://127.0.0.1:${LOCAL_PORT}`, `http://localhost:${LOCAL_PORT}`] : [`https://${TAILSCALE_HOST}`];
          if (origin && !okOrigins.includes(origin)) {
            res.writeHead(403).end();
            return;
          }
          if (limiter.locked(d.login)) return unlockPage(res, "여러 번 틀려서 10분 동안 잠겼습니다.");
          if (listener === "local" && !origin) {
            res.writeHead(403).end();
            return;
          }
          const form = new URLSearchParams(await readBody(req).catch(() => ""));
          const nextPath = (form.get("next") ?? "/").startsWith("/") ? (form.get("next") ?? "/") : "/";
          if (!verifyPasscode(form.get("passcode") ?? "", authConfig().passcodeHash)) {
            limiter.fail(d.login);
            return unlockPage(res, "패스코드가 맞지 않습니다.", nextPath);
          }
          limiter.success(d.login);
          res.writeHead(303, { "Set-Cookie": sessionCookie(createSession(d.login, secret), listener), Location: nextPath.startsWith("//") ? "/" : nextPath });
          res.end();
          return;
        }
        return unlockPage(res, "", url.pathname === "/unlock" ? "/" : url.pathname + url.search);
      }
      handle(req, res);
    });

  make("local").listen(LOCAL_PORT, "127.0.0.1", () => console.log(`> 본인 접속: http://127.0.0.1:${LOCAL_PORT} (${dev ? "개발" : "운영"} 모드)`));
  make("tailscale").listen(TS_PORT, "127.0.0.1", () => console.log(`> Tailscale 전용: 127.0.0.1:${TS_PORT} → https://${TAILSCALE_HOST}`));
}

main();
