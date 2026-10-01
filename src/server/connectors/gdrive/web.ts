import crypto from "node:crypto";
import { DriveClient, driveEnv } from "./client";
import { keychainStore } from "./tokens";

/** 웹 서버 쪽 Drive 클라이언트 (미리보기·다운로드·폴더 고르기용) */
const g = globalThis as unknown as { __hubDrive?: DriveClient; __hubOAuth?: Map<string, { verifier: string; exp: number }> };
export function webDrive(): DriveClient {
  if (!g.__hubDrive) g.__hubDrive = new DriveClient({ fetch, tokens: keychainStore, ...driveEnv() });
  return g.__hubDrive;
}
export function resetWebDrive() {
  g.__hubDrive = undefined;
}

export const REDIRECT_URI = "http://127.0.0.1:3000/api/gdrive/callback";

/** OAuth 시작: state 와 PKCE 값을 10분 동안 기억한다 */
export function beginOAuth() {
  g.__hubOAuth ??= new Map();
  const now = Date.now();
  for (const [k, v] of g.__hubOAuth) if (v.exp < now) g.__hubOAuth.delete(k);
  const state = crypto.randomBytes(16).toString("base64url");
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  g.__hubOAuth.set(state, { verifier, exp: now + 10 * 60_000 });
  return { state, challenge };
}

export function takeOAuth(state: string): string | null {
  const v = g.__hubOAuth?.get(state);
  g.__hubOAuth?.delete(state);
  return v && v.exp > Date.now() ? v.verifier : null;
}
