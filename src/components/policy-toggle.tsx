import { setPolicyAction } from "@/app/chat/policy-actions";

/** 🔒 외부 AI 전송 금지 스위치. inherited: 상위(소스·폴더·프로젝트)에서 이미 금지된 이유 */
export function PolicyToggle({ kind, id, denied, inherited = [] }: { kind: "source" | "folder" | "project" | "item"; id: number; denied: boolean; inherited?: string[] }) {
  const what = { source: "이 소스", folder: "이 폴더(하위 전체)", project: "이 프로젝트", item: "이 항목" }[kind];
  return (
    <form action={setPolicyAction.bind(null, kind, id, !denied)} className="inline-flex flex-wrap items-center gap-2 text-sm">
      <button
        type="submit"
        className={`rounded-full border px-3 py-1 text-xs ${denied ? "border-amber-500 bg-amber-500/15 text-amber-800 dark:text-amber-300" : "text-muted-foreground hover:bg-muted"}`}
        title={denied ? `${what}의 외부 AI 전송 금지를 풉니다` : `${what}을(를) Claude·ChatGPT 로 보내지 않습니다 (로컬 AI 는 사용)`}
      >
        {denied ? "🔒 외부 AI 금지" : "🔓 외부 AI 허용"}
      </button>
      {inherited.length > 0 && <span className="text-xs text-amber-700 dark:text-amber-400">🔒 {inherited.join(", ")}에서 금지됨</span>}
    </form>
  );
}
