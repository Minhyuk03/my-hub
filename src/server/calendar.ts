/**
 * Mac 캘린더 앱 일정 (EventKit)
 * - 캘린더 접근 권한은 앱 단위로 주므로, 작은 도우미 앱(HubCalendar.app)을 `open` 으로 실행해 JSON 파일로 받는다.
 *   (워커가 직접 실행하면 권한 요청이 node 에 붙어 버린다)
 * - 처음 실행할 때 macOS 가 "캘린더 접근 허용" 창을 띄운다 → 사용자가 직접 허용.
 * - 일정은 홈 화면에만 보여 주고, 검색 색인·AI 에는 넣지 않는다.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/config";

export type CalendarEvent = { title: string; start: number; end: number; allDay: boolean; calendar: string; color: string; location?: string };
export type CalendarSnapshot = {
  status: "ok" | "denied" | "error";
  message?: string;
  at: number;
  days: number;
  calendars: { title: string; color: string; source: string }[];
  events: CalendarEvent[];
};

export const CALENDAR_APP = path.join(process.env.HOME ?? "", "Library/Application Support/my-hub/runtime/HubCalendar.app");
const OUT = path.join(DATA_DIR, "calendar.json");

export const calendarAppInstalled = () => fs.existsSync(path.join(CALENDAR_APP, "Contents/MacOS/HubCalendar"));

/** 도우미 앱을 실행해 앞으로 days 일의 일정을 읽는다 (권한 창이 뜨면 사용자가 누를 때까지 최대 timeoutMs 기다림) */
export function readCalendar(days = 7, timeoutMs = 120_000): Promise<CalendarSnapshot> {
  return new Promise((resolve) => {
    if (!calendarAppInstalled()) return resolve({ status: "error", message: "도우미 앱이 없습니다 (scripts/service/build-native.sh)", at: Date.now(), days, calendars: [], events: [] });
    try {
      fs.rmSync(OUT, { force: true });
    } catch {}
    // -g 앞으로 가져오지 않음, -j 숨김, -n 새로 실행, -W 끝날 때까지 기다림
    execFile("/usr/bin/open", ["-g", "-j", "-n", "-W", CALENDAR_APP, "--args", "--out", OUT, "--days", String(days)], { timeout: timeoutMs }, (err) => {
      try {
        const j = JSON.parse(fs.readFileSync(OUT, "utf8")) as CalendarSnapshot;
        resolve({ ...j, at: Date.now(), days });
      } catch {
        resolve({ status: "error", message: err ? err.message.slice(0, 200) : "결과 파일이 없습니다", at: Date.now(), days, calendars: [], events: [] });
      }
    });
  });
}
