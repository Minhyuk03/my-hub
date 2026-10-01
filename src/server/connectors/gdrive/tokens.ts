import { execFile } from "node:child_process";

/**
 * Google 연결 토큰(refresh token) 보관소: macOS 키체인.
 * 값은 로그·화면에 출력하지 않는다. 테스트에서는 메모리 보관소를 쓴다.
 */
export type TokenStore = {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
};

const SERVICE = "my-hub.google-drive";
const ACCOUNT = "my-hub";

function run(args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) =>
    execFile("/usr/bin/security", args, { timeout: 10_000 }, (err, stdout) => resolve({ ok: !err, out: String(stdout ?? "").trim() })),
  );
}

export const keychainStore: TokenStore = {
  async get() {
    const r = await run(["find-generic-password", "-a", ACCOUNT, "-s", SERVICE, "-w"]);
    return r.ok && r.out ? r.out : null;
  },
  async set(token) {
    const r = await run(["add-generic-password", "-U", "-a", ACCOUNT, "-s", SERVICE, "-l", "my-hub Google Drive", "-w", token]);
    if (!r.ok) throw new Error("키체인에 저장하지 못했습니다.");
  },
  async clear() {
    await run(["delete-generic-password", "-a", ACCOUNT, "-s", SERVICE]);
  },
};

export function memoryStore(initial: string | null = null): TokenStore {
  let v = initial;
  return {
    get: async () => v,
    set: async (t) => {
      v = t;
    },
    clear: async () => {
      v = null;
    },
  };
}
