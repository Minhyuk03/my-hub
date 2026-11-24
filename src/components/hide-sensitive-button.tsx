"use client";

import { hideSensitiveAction } from "@/app/settings/sensitive-actions";

/** 민감 정보로 숨기기: 이 폴더(하위 전체)·항목을 허브 어디에도 보이지 않게 한다. 실제 파일은 그대로 */
export function HideSensitiveButton({ kind, id }: { kind: "folder" | "item"; id: number }) {
  const what = kind === "folder" ? "이 폴더와 하위 전체" : "이 항목";
  return (
    <form action={hideSensitiveAction.bind(null, kind, id)}>
      <button
        type="submit"
        className="rounded-full border px-3 py-1 text-xs text-muted-foreground hover:border-destructive hover:text-destructive"
        title={`${what}을(를) 허브의 목록·검색·그래프·AI 어디에도 보이지 않게 합니다`}
        onClick={(e) => {
          if (
            !confirm(
              `${what}을(를) 민감 정보로 숨길까요?\n\n· 허브의 목록·검색·그래프·홈·AI 어디에도 나오지 않습니다.\n· 이 자료를 인용한 AI 답변과 프로젝트 연결·즐겨찾기도 지웁니다.\n· 실제 파일은 그대로입니다. 설정 → 민감 정보에서 다시 보이게 할 수 있습니다.`,
            )
          )
            e.preventDefault();
        }}
      >
        🙈 민감 정보로 숨기기
      </button>
    </form>
  );
}
