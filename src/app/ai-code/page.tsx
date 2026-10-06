import { CodeWorkspace } from "./workspace";

/** Mac mini 본인 접속과 Tailscale 접속(허용 계정 + 앱 패스코드) 모두에서 쓸 수 있다 */
export default function Page() {
  return <CodeWorkspace />;
}
