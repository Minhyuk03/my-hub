"use client";

import { ChevronUp } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * 홈 아래쪽 서랍: 평소에는 화살표만 보이고, 누르면 카드(일정·이어서 작업하기·최근 수정)가 아래에서 올라온다.
 * 열림 상태는 이 브라우저에만 기억한다.
 */
const remember = (v: boolean) => {
  try {
    localStorage.setItem("hub.home.drawer", v ? "open" : "closed");
  } catch {}
};

export function HomeDrawer({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      // 화면이 뜬 뒤에만 브라우저 저장값을 읽을 수 있다
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem("hub.home.drawer") === "open") setOpen(true);
    } catch {}
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      remember(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const set = (v: boolean) => {
    setOpen(v);
    remember(v);
  };
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex flex-col items-center">
      <button
        type="button"
        onClick={() => set(!open)}
        aria-expanded={open}
        aria-controls="home-drawer"
        aria-label={open ? "카드 내리기" : "일정·이어서 작업하기·최근 수정 보기"}
        title={open ? "내리기" : "일정 · 이어서 작업하기 · 최근 수정"}
        className="pointer-events-auto mb-2 flex items-center gap-1.5 rounded-full border bg-background/80 px-4 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-background hover:text-foreground"
      >
        <ChevronUp className={`size-4 transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
        {open ? "내리기" : "일정 · 이어서 작업하기 · 최근 수정"}
      </button>
      <div
        id="home-drawer"
        inert={!open}
        className={`pointer-events-auto w-full overflow-hidden transition-[max-height,opacity] duration-300 ease-out ${open ? "max-h-[70vh] opacity-100" : "max-h-0 opacity-0"}`}
      >
        <div className="max-h-[70vh] overflow-y-auto border-t border-foreground/10 bg-background/85 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 shadow-[0_-8px_24px_rgba(0,0,0,0.15)] backdrop-blur-md">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </div>
      </div>
    </div>
  );
}
