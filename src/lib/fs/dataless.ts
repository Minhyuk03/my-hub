import { execFile, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Stats } from "node:fs";

/** macOS SF_DATALESS: iCloud 등에서 내용을 아직 내려받지 않은 파일. */
const SF_DATALESS = 0x40000000;

/**
 * 내용을 아직 내려받지 않은(iCloud에만 있는) 파일인지 판단한다.
 * Node 의 stat 에는 파일 플래그가 없으므로, 블록이 0인데 크기가 있는 파일만 `stat -f %Xf` 로 확인한다.
 * (압축된 시스템 파일도 블록이 0일 수 있어서 플래그로 최종 확인)
 * 플래그를 읽지 못하면 "내려받지 않음"으로 본다. 확실하지 않을 때 읽으면 백그라운드 프로세스에서는 읽기가 실패한다.
 */
export function isDataless(filePath: string, st: Stats): boolean {
  if (!st.isFile() || st.size === 0 || st.blocks > 0) return false;
  const flags = readFlags(filePath);
  return flags == null ? true : (flags & SF_DATALESS) !== 0;
}

export function readFlags(filePath: string): number | null {
  try {
    const out = execFileSync("/usr/bin/stat", ["-f", "%Xf", filePath], { encoding: "utf8", timeout: 5000 });
    const n = parseInt(out.trim(), 16);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** iCloud 가 백그라운드 프로세스의 읽기를 거절할 때의 오류 (EDEADLK, errno 11) */
export function isMaterializeRefused(e: unknown): boolean {
  const err = e as NodeJS.ErrnoException;
  return err?.errno === -11 || err?.errno === 11 || String(err?.code ?? "").includes("-11") || err?.code === "EDEADLK";
}

/** 내려받기 도우미 (native/materialize.c, scripts/service/build-native.sh 로 빌드) */
export const MATERIALIZE_HELPER =
  process.env.HUB_MATERIALIZE_HELPER ?? path.join(os.homedir(), "Library/Application Support/my-hub/runtime/hub-materialize");

const inFlight = new Map<string, Promise<void>>();

const isReady = (filePath: string) => {
  try {
    const st = fs.statSync(filePath);
    return st.size === 0 || st.blocks > 0;
  } catch {
    return false;
  }
};

/**
 * iCloud 에만 있는 파일을 내려받는다. launchd 로 실행된 프로세스는 읽기만으로는 내려받을 수 없어서
 * 도우미(hub-materialize)가 내려받기를 허용한 상태로 파일을 읽는다. iCloud 가 느리면 몇 분 걸릴 수 있다.
 * waitMs 안에 끝나면 true. 끝나지 않아도 내려받기는 계속 진행된다. (사용자가 직접 열거나 다운로드할 때만 호출)
 */
export async function materialize(filePath: string, waitMs = 20_000): Promise<boolean> {
  if (isReady(filePath)) return true;
  if (!inFlight.has(filePath)) {
    const job = new Promise<void>((resolve) =>
      execFile(MATERIALIZE_HELPER, [filePath], { timeout: 15 * 60_000 }, () => {
        inFlight.delete(filePath);
        resolve();
      }),
    );
    inFlight.set(filePath, job);
  }
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    if (isReady(filePath)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return isReady(filePath);
}
