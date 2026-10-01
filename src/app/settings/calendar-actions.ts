"use server";

import { refresh } from "next/cache";
import { getDb } from "@/server/db";
import { enqueue } from "@/server/sources/manage";
import { setSetting } from "@/server/settings";

/** 연결: 워커가 도우미 앱을 실행 → 처음이면 Mac 화면에 "캘린더 접근 허용" 창이 뜬다 */
export async function connectCalendar() {
  const db = getDb();
  setSetting(db, "calendarEnabled", true);
  enqueue(db, "calendar_refresh", {});
  refresh();
}

export async function disconnectCalendar() {
  setSetting(getDb(), "calendarEnabled", false);
  refresh();
}

export async function refreshCalendar() {
  enqueue(getDb(), "calendar_refresh", {});
  refresh();
}

export async function saveCalendarHidden(form: FormData) {
  const db = getDb();
  const shown = new Set(form.getAll("show").map(String));
  const all = form.getAll("all").map(String);
  setSetting(db, "calendarHidden", all.filter((c) => !shown.has(c)));
  refresh();
}
