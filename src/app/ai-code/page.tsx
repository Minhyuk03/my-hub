import { headers } from "next/headers";
import { isLocalRequest } from "@/server/http/local";
import { CodeWorkspace } from "./workspace";

/** Mac 에서 프로그램을 실행하는 기능이라 Mac mini 본인 접속에서만 보여 준다 (API 도 같은 검사) */
export default async function Page() {
  if (!isLocalRequest(await headers()))
    return <p className="text-sm text-muted-foreground">AI 코드는 Mac mini 에서 직접 접속한 경우(http://127.0.0.1:3000)에만 쓸 수 있습니다.</p>;
  return <CodeWorkspace />;
}
