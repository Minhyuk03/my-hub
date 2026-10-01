import { isLocalRequest } from "@/server/http/local";
import { authUrl, driveEnv } from "@/server/connectors/gdrive/client";
import { beginOAuth, REDIRECT_URI } from "@/server/connectors/gdrive/web";

/** Google Drive 연결 시작 (Mac mini 본인 접속에서만: 돌아오는 주소가 127.0.0.1 이므로) */
export async function GET(req: Request) {
  if (!isLocalRequest(req.headers)) return new Response("Mac mini에서 직접 접속한 경우에만 연결할 수 있습니다.", { status: 403 });
  const env = driveEnv();
  if (!env.configured) return new Response(".env.local 에 GOOGLE_CLIENT_ID 와 GOOGLE_CLIENT_SECRET 이 필요합니다.", { status: 400 });
  const { state, challenge } = beginOAuth();
  return Response.redirect(authUrl({ clientId: env.clientId, redirectUri: REDIRECT_URI, state, codeChallenge: challenge }), 302);
}
