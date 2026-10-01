import type { NextRequest } from "next/server";
import { getDb } from "@/server/db";
import { driveEnv, exchangeCode } from "@/server/connectors/gdrive/client";
import { keychainStore } from "@/server/connectors/gdrive/tokens";
import { REDIRECT_URI, resetWebDrive, takeOAuth, webDrive } from "@/server/connectors/gdrive/web";
import { isLocalRequest } from "@/server/http/local";
import { enqueue } from "@/server/sources/manage";
import { setSetting } from "@/server/settings";

const back = (msg: string) => Response.redirect(`http://127.0.0.1:3000/settings?gdrive=${encodeURIComponent(msg)}#gdrive`, 302);

/** Google 이 돌려보낸 코드로 연결을 마친다. 토큰은 키체인에만 저장하고 출력하지 않는다. */
export async function GET(req: NextRequest) {
  if (!isLocalRequest(req.headers)) return new Response("허용되지 않은 요청입니다.", { status: 403 });
  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return back(sp.get("error") === "access_denied" ? "연결을 취소했습니다." : `연결 실패: ${sp.get("error")}`);
  const verifier = takeOAuth(sp.get("state") ?? "");
  if (!verifier) return back("연결 요청이 만료되었습니다. 다시 시도하세요.");
  try {
    const env = driveEnv();
    const refresh = await exchangeCode(fetch, { ...env, code: sp.get("code") ?? "", verifier, redirectUri: REDIRECT_URI });
    await keychainStore.set(refresh);
    resetWebDrive();
    const about = await webDrive().about();
    const db = getDb();
    setSetting(db, "gdriveAccount", { email: about.user.emailAddress, name: about.user.displayName, connectedAt: Date.now() });
    enqueue(db, "drive_connected");
    return back("연결했습니다.");
  } catch (e) {
    return back(`연결 실패: ${(e as Error).message}`);
  }
}
