import fs from "node:fs";
import path from "node:path";
import { EXCLUDED_VOLUME_PATTERNS, HOME, PATHS } from "@/lib/config";
import type { SourceKind } from "../db/schema";

/** 간단한 이름 패턴: "*.app", ".env*", "node_modules" */
export function matchPattern(name: string, pattern: string): boolean {
  if (!pattern.includes("*")) return name === pattern;
  const re = new RegExp("^" + pattern.split("*").map(escapeRe).join(".*") + "$", "i");
  return re.test(name);
}
const escapeRe = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

export function isExcludedName(name: string, patterns: string[]): boolean {
  if (name.startsWith(".")) {
    // 숨김 파일·폴더는 기본 제외 (.obsidian, .Trash 등)
    return true;
  }
  return patterns.some((p) => matchPattern(name, p));
}

export const isInside = (child: string, parent: string) =>
  child === parent || child.startsWith(parent.endsWith("/") ? parent : parent + "/");

export function isExcludedVolume(p: string): boolean {
  return EXCLUDED_VOLUME_PATTERNS.some((re) => re.test(p));
}

export function isExcludedFolder(p: string, excludedFolders: string[]): boolean {
  return excludedFolders.some((f) => isInside(p, f));
}

/** /Volumes/Disk/a/b → /Volumes/Disk */
export function volumeRootOf(p: string): string | null {
  const m = p.match(/^\/Volumes\/[^/]+/);
  return m ? m[0] : null;
}

export function detectKind(realPath: string): SourceKind {
  if (isInside(realPath, PATHS.obsidianVault)) return "obsidian";
  if (volumeRootOf(realPath)) return "external";
  const icloudRoots = [PATHS.icloudDrive, path.join(HOME, "Library/Mobile Documents")];
  // "데스크탑 및 문서 폴더" 동기화가 켜져 있으면 ~/Documents, ~/Desktop 도 iCloud
  for (const d of ["Documents", "Desktop"]) {
    try {
      if (fs.lstatSync(path.join(PATHS.icloudDrive, d)).isSymbolicLink()) icloudRoots.push(path.join(HOME, d));
    } catch {}
  }
  if (icloudRoots.some((r) => isInside(realPath, r))) return "icloud";
  return "local";
}

export type SourceCheck = {
  ok: boolean;
  error?: string;
  warnings: string[];
  realPath?: string;
  kind?: SourceKind;
  volumeRoot?: string | null;
};

/**
 * 인덱싱 폴더를 추가해도 되는지 확인한다.
 * - 제외 폴더·제외 볼륨 안은 금지
 * - 같은 실제 경로가 이미 등록돼 있으면 금지
 * - 다른 소스의 하위·상위면 경고 (파일은 더 구체적인 소스에서 한 번만 인덱싱)
 */
export function checkNewSource(
  inputPath: string,
  ctx: { existingRoots: string[]; excludedFolders: string[] },
): SourceCheck {
  const warnings: string[] = [];
  let realPath: string;
  try {
    realPath = fs.realpathSync(inputPath);
  } catch {
    return { ok: false, error: "폴더를 찾을 수 없습니다.", warnings };
  }
  if (!fs.statSync(realPath).isDirectory()) return { ok: false, error: "폴더가 아닙니다.", warnings };
  if (isExcludedVolume(realPath)) return { ok: false, error: "인덱싱하지 않는 볼륨입니다.", warnings };
  if (isExcludedFolder(realPath, ctx.excludedFolders))
    return { ok: false, error: "제외 폴더 안에는 추가할 수 없습니다.", warnings };
  if (realPath === "/" || realPath === HOME || realPath === "/Volumes")
    return { ok: false, error: "너무 넓은 범위입니다. 하위 폴더를 선택하세요.", warnings };
  try {
    fs.readdirSync(realPath);
  } catch {
    return { ok: false, error: "읽기 권한이 없습니다. (전체 디스크 접근 권한 확인)", warnings };
  }
  for (const r of ctx.existingRoots) {
    if (r === realPath) return { ok: false, error: "이미 등록된 폴더입니다.", warnings };
    if (isInside(realPath, r)) warnings.push(`이미 등록된 ${r} 의 하위 폴더입니다. 이 폴더의 파일은 새 소스로 옮겨 한 번만 인덱싱합니다.`);
    if (isInside(r, realPath)) warnings.push(`이미 등록된 ${r} 을(를) 포함합니다. 그 폴더는 기존 소스에서 계속 인덱싱합니다.`);
  }
  if (realPath !== inputPath) warnings.push(`실제 경로 ${realPath} 로 등록합니다.`);
  return { ok: true, warnings, realPath, kind: detectKind(realPath), volumeRoot: volumeRootOf(realPath) };
}

/** 새 폴더 만들기: 외장 디스크 안, 기존 폴더 바로 아래에만 허용 */
export function checkNewFolder(parent: string, name: string, excludedFolders: string[]): { ok: boolean; error?: string; path?: string } {
  const clean = name.trim().normalize("NFC");
  if (!clean || clean.includes("/") || clean.startsWith(".")) return { ok: false, error: "폴더 이름이 올바르지 않습니다." };
  let realParent: string;
  try {
    realParent = fs.realpathSync(parent);
  } catch {
    return { ok: false, error: "상위 폴더를 찾을 수 없습니다." };
  }
  if (!volumeRootOf(realParent)) return { ok: false, error: "새 폴더는 외장 디스크 안에만 만들 수 있습니다." };
  if (isExcludedVolume(realParent)) return { ok: false, error: "인덱싱하지 않는 볼륨입니다." };
  const target = path.join(realParent, clean);
  if (isExcludedFolder(target, excludedFolders)) return { ok: false, error: "제외 폴더 안에는 만들 수 없습니다." };
  if (fs.existsSync(target)) return { ok: false, error: "같은 이름의 폴더가 이미 있습니다." };
  return { ok: true, path: target };
}
