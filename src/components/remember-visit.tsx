"use client";

import { useEffect } from "react";
import { rememberVisit, type Visit } from "@/lib/recent-visits";

/** 항목 화면을 열면 "최근 연 항목"에 기록 */
export function RememberVisit(v: Visit) {
  useEffect(() => rememberVisit(v), [v.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
