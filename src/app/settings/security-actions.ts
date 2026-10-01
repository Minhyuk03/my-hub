"use server";

import { headers } from "next/headers";
import { refresh } from "next/cache";
import { getDb } from "@/server/db";
import { hashPasscode } from "@/server/http/auth";
import { isLocalRequest } from "@/server/http/local";
import { setSetting } from "@/server/settings";

/** 보안 설정은 Mac mini 본인 접속에서만 바꿀 수 있다 */
async function assertLocal() {
  if (!isLocalRequest(await headers())) throw new Error("Mac mini에서 직접 접속한 경우에만 바꿀 수 있습니다.");
}

export async function saveAllowlist(form: FormData) {
  await assertLocal();
  const logins = String(form.get("logins") ?? "")
    .split("\n")
    .map((x) => x.trim().toLowerCase())
    .filter((x) => x.includes("@"));
  setSetting(getDb(), "allowedTailscaleLogins", [...new Set(logins)]);
  refresh();
}

export async function savePasscode(_: unknown, form: FormData): Promise<{ ok: boolean; message: string }> {
  await assertLocal();
  const a = String(form.get("passcode") ?? "");
  const b = String(form.get("confirm") ?? "");
  if (a.length < 6) return { ok: false, message: "6자 이상 입력하세요." };
  if (a !== b) return { ok: false, message: "두 번 입력한 값이 다릅니다." };
  setSetting(getDb(), "passcodeHash", hashPasscode(a));
  return { ok: true, message: "패스코드를 저장했습니다. 다른 기기는 다음 접속 때 한 번 입력합니다." };
}

/** Mac mini 본인 접속에도 패스코드 요구 (패스코드가 있어야 켤 수 있다) */
export async function setRequireLocalPasscode(on: boolean) {
  await assertLocal();
  const db = getDb();
  const { getSettings } = await import("@/server/settings");
  if (on && !getSettings(db).passcodeHash) throw new Error("먼저 앱 패스코드를 정하세요.");
  setSetting(db, "requireLocalPasscode", on);
  refresh();
}
