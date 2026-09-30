"use client";

import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

const DURATION = 500;

function apply(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem("theme", dark ? "dark" : "light");
  } catch {}
}

export function ThemeToggle() {
  const toggle = () => {
    const dark = !document.documentElement.classList.contains("dark");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return apply(dark);
    // 화면 전체를 부드럽게 바꾼다: 지원하는 브라우저는 View Transitions(교차 페이드), 아니면 색 전환 애니메이션
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (doc.startViewTransition) {
      doc.startViewTransition(() => apply(dark));
      return;
    }
    const root = document.documentElement;
    root.classList.add("theme-transition");
    apply(dark);
    window.setTimeout(() => root.classList.remove("theme-transition"), DURATION);
  };
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-label="화면 테마 전환">
      <Sun className="size-4 dark:hidden" />
      <Moon className="hidden size-4 dark:block" />
    </Button>
  );
}
