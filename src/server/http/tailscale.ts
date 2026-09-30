import { execFileSync } from "node:child_process";
import fs from "node:fs";

const CLI = ["/Applications/Tailscale.app/Contents/MacOS/Tailscale", "/opt/homebrew/bin/tailscale", "/usr/local/bin/tailscale"].find((p) => fs.existsSync(p));

/** 이 Mac 의 Tailscale 로그인 계정과 주소 */
export function tailscaleSelf(): { login: string; dnsName: string; online: boolean } | null {
  if (!CLI) return null;
  try {
    const j = JSON.parse(execFileSync(CLI, ["status", "--json"], { encoding: "utf8", timeout: 5000 }));
    const user = j.User?.[String(j.Self?.UserID)];
    return { login: user?.LoginName ?? "", dnsName: String(j.Self?.DNSName ?? "").replace(/\.$/, ""), online: !!j.Self?.Online };
  } catch {
    return null;
  }
}

export function tailscaleServeStatus(): string {
  if (!CLI) return "Tailscale 이 설치되어 있지 않습니다.";
  try {
    return execFileSync(CLI, ["serve", "status"], { encoding: "utf8", timeout: 5000 }).trim();
  } catch (e) {
    return `확인 실패: ${(e as Error).message}`;
  }
}
