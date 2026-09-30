import { execFileSync } from "node:child_process";
import type { Stats } from "node:fs";

/** macOS SF_DATALESS: iCloud 등에서 내용을 아직 내려받지 않은 파일. */
const SF_DATALESS = 0x40000000;

/**
 * 내용을 읽으면 iCloud 다운로드가 시작되는 파일인지 판단한다.
 * Node의 stat에는 파일 플래그가 없으므로, 블록이 0인데 크기가 있는 파일만 `stat -f %Xf`로 확인한다.
 * (압축된 시스템 파일도 블록이 0일 수 있어서 플래그로 최종 확인)
 */
export function isDataless(filePath: string, st: Stats): boolean {
  if (!st.isFile() || st.size === 0 || st.blocks > 0) return false;
  return (readFlags(filePath) & SF_DATALESS) !== 0;
}

export function readFlags(filePath: string): number {
  try {
    const out = execFileSync("/usr/bin/stat", ["-f", "%Xf", filePath], { encoding: "utf8" });
    return parseInt(out.trim(), 16) || 0;
  } catch {
    return 0;
  }
}
