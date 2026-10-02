import { execFileSync } from "node:child_process";
import fs from "node:fs";

/** Tailscale 앱의 명령은 TERM 이 없으면(launchd 로 실행될 때) 명령 대신 앱 화면을 띄우려다 실패한다 */
const ENV = { ...process.env, TERM: process.env.TERM || "dumb" };

const CLI = ["/Applications/Tailscale.app/Contents/MacOS/Tailscale", "/opt/homebrew/bin/tailscale", "/usr/local/bin/tailscale"].find((p) => fs.existsSync(p));

/** 이 Mac 의 Tailscale 로그인 계정과 주소 */
export function tailscaleSelf(): { login: string; dnsName: string; online: boolean } | null {
  if (!CLI) return null;
  try {
    const j = JSON.parse(execFileSync(CLI, ["status", "--json"], { encoding: "utf8", timeout: 5000, env: ENV }));
    const user = j.User?.[String(j.Self?.UserID)];
    return { login: user?.LoginName ?? "", dnsName: String(j.Self?.DNSName ?? "").replace(/\.$/, ""), online: !!j.Self?.Online };
  } catch (e) {
    if (process.env.HUB_DEBUG_TS) console.error((e as Error).message.slice(0, 300));
    return null;
  }
}

export function tailscaleServeStatus(): string {
  if (!CLI) return "Tailscale 이 설치되어 있지 않습니다.";
  try {
    return execFileSync(CLI, ["serve", "status"], { encoding: "utf8", timeout: 5000, env: ENV }).trim();
  } catch (e) {
    return `확인 실패: ${(e as Error).message}`;
  }
}
