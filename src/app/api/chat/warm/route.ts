import { getDb } from "@/server/db";
import { getSettings } from "@/server/settings";

/** 채팅 화면을 열면 로컬 대화 모델을 미리 올려 둔다 (처음 불러오기에 20~60초 걸림) */
export async function POST() {
  const model = getSettings(getDb()).chatLocalModel;
  const url = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
  // 기다리지 않는다: 불러오는 동안 화면은 그대로 쓸 수 있다
  void fetch(`${url}/api/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, keep_alive: "10m" }) }).catch(() => {});
  return Response.json({ ok: true });
}
