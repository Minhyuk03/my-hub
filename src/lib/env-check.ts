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

function checkPath(label: string, p: string): PathCheck {
  const exists = fs.existsSync(p);
  let readable = false;
  if (exists) {
    try {
      fs.readdirSync(p);
      readable = true;
    } catch {
      readable = false;
    }
  }
  return { label, path: p, exists, readable };
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

export function runEnvCheck() {
  const paths: PathCheck[] = [
    checkPath("Obsidian 볼트", PATHS.obsidianVault),
    checkPath("iCloud Drive", PATHS.icloudDrive),
    checkPath("Claude Code 세션", PATHS.claudeProjects),
    ...PATHS.externalVolumes.map((v) => checkPath(`외장 디스크 ${path.basename(v)}`, v)),
  ];
  const vault = paths[0];
  if (vault.exists && !fs.existsSync(path.join(PATHS.obsidianVault, ".obsidian"))) {
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
