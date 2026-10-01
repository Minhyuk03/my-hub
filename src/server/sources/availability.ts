import fs from "node:fs";
import { isMountPoint, volumeUuid } from "@/lib/env-check";

/** 테스트에서 디스크 분리를 흉내 낼 수 있도록 마운트 확인을 주입받는다. */
export type MountEnv = {
  isMountPoint(p: string): boolean;
  volumeUuid(p: string): string | undefined;
};

export const realMountEnv: MountEnv = { isMountPoint, volumeUuid };

export type Availability =
  | { ok: true }
  | { ok: false; status: "offline"; reason: string }
  | { ok: false; status: "error"; reason: string };

type SourceLike = { rootPath: string; volumeRoot: string | null; volumeUuid: string | null };

/**
 * 소스를 지금 스캔해도 되는지 확인한다.
 * 외장 디스크를 분리하면 /Volumes/Disk 가 사라지거나, 내장 디스크에 같은 이름의 빈 폴더가 남을 수 있다.
 * 이때 "파일이 전부 사라졌다"고 판단하지 않도록 실제 마운트 여부와 볼륨 UUID를 먼저 확인한다.
 */
export function checkAvailability(src: SourceLike, env: MountEnv = realMountEnv): Availability {
  // 클라우드 소스(Google Drive 등)는 파일시스템이 아니라 API 호출 결과로 상태를 정한다
  if (src.rootPath.startsWith("gdrive:") || src.rootPath.startsWith("notion:") || src.rootPath.startsWith("github:")) return { ok: true };
  if (src.volumeRoot) {
    if (!env.isMountPoint(src.volumeRoot)) return { ok: false, status: "offline", reason: "외장 디스크가 연결되어 있지 않습니다." };
    if (src.volumeUuid) {
      const uuid = env.volumeUuid(src.volumeRoot);
      if (uuid && uuid !== src.volumeUuid)
        return { ok: false, status: "offline", reason: "같은 이름의 다른 디스크가 연결되어 있습니다." };
    }
  }
  if (!fs.existsSync(src.rootPath)) return { ok: false, status: "error", reason: "폴더 없음 (이동 또는 삭제됨)" };
  try {
    fs.readdirSync(src.rootPath);
  } catch {
    return { ok: false, status: "error", reason: "읽기 권한이 없습니다." };
  }
  return { ok: true };
}
