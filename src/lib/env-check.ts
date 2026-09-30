import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, PATHS } from "./config";

export type PathCheck = {
  label: string;
  path: string;
  exists: boolean;
  readable: boolean;
  note?: string;
};

export type VolumeCheck = {
  path: string;
  mounted: boolean;
  volumeUuid?: string;
  totalBytes?: number;
  freeBytes?: number;
};

/**
 * 폴더를 읽을 수 있는지 확인한다. macOS 개인정보 보호 권한을 기다리는 동안 읽기가 멈출 수 있으므로
 * 비동기로 읽고 3초가 지나면 "권한 대기"로 본다. (동기 읽기는 웹 서버 전체를 멈춘다)
 */
async function checkPath(label: string, p: string): Promise<PathCheck> {
  const exists = fs.existsSync(p);
  if (!exists) return { label, path: p, exists, readable: false };
  const r = await Promise.race([
    fs.promises.readdir(p).then(
      () => "ok" as const,
      () => "denied" as const,
    ),
    new Promise<"timeout">((res) => setTimeout(() => res("timeout"), 3000)),
  ]);
  return {
    label,
    path: p,
    exists,
    readable: r === "ok",
    note: r === "timeout" ? "권한 대기 중 — 전체 디스크 접근 권한을 확인하세요" : r === "denied" ? "읽기 권한 없음" : undefined,
  };
}

/**
 * 실제 마운트 지점인지 확인한다. 디스크를 분리한 뒤 내장 디스크에 같은 이름의 빈 폴더가 남는 경우를 걸러낸다.
 */
export function isMountPoint(p: string): boolean {
  try {
    const st = fs.statSync(p);
    const parent = fs.statSync(path.dirname(p));
    return st.dev !== parent.dev;
  } catch {
    return false;
  }
}

export function volumeUuid(p: string): string | undefined {
  try {
    const out = execFileSync("/usr/sbin/diskutil", ["info", p], { encoding: "utf8" });
    return out.match(/Volume UUID:\s+([0-9A-F-]+)/)?.[1];
  } catch {
    return undefined;
  }
}

function checkVolume(p: string): VolumeCheck {
  if (!isMountPoint(p)) return { path: p, mounted: false };
  const s = fs.statfsSync(p);
  return {
    path: p,
    mounted: true,
    volumeUuid: volumeUuid(p),
    totalBytes: s.blocks * s.bsize,
    freeBytes: s.bavail * s.bsize,
  };
}

export async function runEnvCheck() {
  const paths: PathCheck[] = await Promise.all([
    checkPath("Obsidian 볼트", PATHS.obsidianVault),
    checkPath("iCloud Drive", PATHS.icloudDrive),
    checkPath("Claude Code 세션", PATHS.claudeProjects),
    ...PATHS.externalVolumes.map((v) => checkPath(`외장 디스크 ${path.basename(v)}`, v)),
  ]);
  const vault = paths[0];
  if (vault.readable && !fs.existsSync(path.join(PATHS.obsidianVault, ".obsidian"))) {
    vault.note = ".obsidian 폴더가 없음 — 볼트 루트가 아닐 수 있음";
  }
  return {
    node: process.version,
    nodeExecPath: process.execPath,
    dataDir: DATA_DIR,
    paths,
    volumes: PATHS.externalVolumes.map(checkVolume),
  };
}
