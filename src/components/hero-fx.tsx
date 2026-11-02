"use client";

import { useEffect, useRef } from "react";

/**
 * 첫 화면 배경 사진 칸: 화면에 붙어 있고, 아래 내용(반투명 판)이 올라올수록 흐려지고 조금 어두워진다 (다시 올리면 선명하게).
 * 진행 정도(0~1)를 --hero-p 로 넘기고, 안쪽 요소가 style 에서 그 값을 쓴다. React 다시 그리기 없이 스타일만 바꾼다.
 */
export function HeroFx({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // 이 페이지에서만 섹션 단위로 딱딱 맞춰 스크롤 (globals.css 의 .snap-page)
    document.documentElement.classList.add("snap-page");
    let raf = 0;
    const update = () => {
      raf = 0;
      const p = Math.min(1, Math.max(0, window.scrollY / Math.max(1, el.offsetHeight * 0.75)));
      el.style.setProperty("--hero-p", p.toFixed(3));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      document.documentElement.classList.remove("snap-page");
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
  // 휠·트랙패드: 한 번만 굴려도 다음(이전) 섹션으로 넘긴다. 화면보다 긴 섹션은 끝에 닿을 때까지 그냥 스크롤
  useEffect(() => {
    let lockedUntil = 0; // 넘기는 애니메이션이 끝날 때까지
    let lastWheel = 0;
    let used = false; // 이번 손짓으로 이미 한 번 넘겼는지 (트랙패드 관성이 끝날 때까지 한 번만)
    const stops = () => {
      const tops = [...document.querySelectorAll<HTMLElement>("[data-snap]")].map((el) => {
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top + window.scrollY), height: r.height };
      });
      const max = document.documentElement.scrollHeight - window.innerHeight;
      return tops.map((t) => ({ ...t, top: Math.min(t.top, max) })).sort((a, b) => a.top - b.top);
    };
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return; // 확대·가로 스크롤은 그대로
      const now = performance.now();
      if (now - lastWheel > 160) used = false; // 잠깐 멈췄다 다시 굴리면 새 손짓
      lastWheel = now;
      if (now < lockedUntil || used) {
        e.preventDefault();
        return;
      }
      if (Math.abs(e.deltaY) < 2) return;
      const list = stops();
      const y = window.scrollY;
      const down = e.deltaY > 0;
      // 지금 보고 있는 섹션이 화면보다 길면, 그 끝에 닿기 전까지는 보통 스크롤
      const cur = [...list].reverse().find((s) => s.top <= y + 2);
      if (cur && cur.height > window.innerHeight + 4) {
        const bottom = cur.top + cur.height - window.innerHeight;
        if ((down && y < bottom - 2) || (!down && y > cur.top + 2)) return;
      }
      const next = down ? list.find((s) => s.top > y + 2) : [...list].reverse().find((s) => s.top < y - 2);
      e.preventDefault();
      if (!next) return;
      // 위로 갈 때 긴 섹션이면 그 섹션의 끝부분으로
      const target = !down && next.height > window.innerHeight + 4 ? next.top + next.height - window.innerHeight : next.top;
      window.scrollTo({ top: target, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      lockedUntil = now + 750;
      used = true;
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <section ref={ref} className={className}>
      {children}
    </section>
  );
}

/** 배경(사진·그라데이션): 흐림·어둡게. 흐림 가장자리가 비치지 않게 칸보다 조금 크게 */
export const heroBackdropStyle: React.CSSProperties = {
  filter: "blur(calc(var(--hero-p, 0) * 18px)) brightness(calc(1 - var(--hero-p, 0) * 0.3))",
  transform: "scale(calc(1.04 + var(--hero-p, 0) * 0.06))",
};

/** 글자: 흐려질 때 함께 옅어진다 */
export const heroTextStyle: React.CSSProperties = { opacity: "calc(1 - var(--hero-p, 0) * 1.4)" as unknown as number };
