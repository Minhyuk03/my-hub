"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** 진행률 표시를 위해 몇 초마다 화면 데이터를 다시 불러온다 */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
