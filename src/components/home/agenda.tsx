import Link from "next/link";
import type { CalendarSnapshot } from "@/server/calendar";

const dayKey = (ms: number) => new Date(ms).toDateString();
function dayLabel(ms: number, now = Date.now()) {
  const d = new Date(ms);
  const today = new Date(now);
  const tomorrow = new Date(now + 86400_000);
  const md = d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", weekday: "short" });
  if (dayKey(ms) === today.toDateString()) return `오늘 · ${md}`;
  if (dayKey(ms) === tomorrow.toDateString()) return `내일 · ${md}`;
  return md;
}
/** 서버에서 그릴 때의 현재 시각 (요청마다 다시 그린다) */
const nowMs = () => Date.now();
const hm = (ms: number) => new Date(ms).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });

/** 홈 사이드: 오늘부터 며칠 일정 (Mac 캘린더 앱) */
export function Agenda({ snap, hidden, maxDays = 3, maxEvents = 10 }: { snap: CalendarSnapshot | null; hidden: string[]; maxDays?: number; maxEvents?: number }) {
  if (!snap || snap.status !== "ok") {
    const msg =
      snap?.status === "denied"
        ? "캘린더 접근이 허용되지 않았습니다."
        : snap?.status === "error"
          ? `일정을 읽지 못했습니다: ${snap.message ?? ""}`
          : "Mac 캘린더 앱의 일정을 보려면 먼저 연결하세요.";
    return (
      <p className="text-sm text-muted-foreground">
        {msg}{" "}
        <Link href="/settings#calendar" className="underline">
          설정
        </Link>
      </p>
    );
  }
  const now = nowMs();
  const events = snap.events.filter((e) => !hidden.includes(e.calendar) && e.end > now).slice(0, maxEvents);
  const days = [...new Set(events.map((e) => dayKey(Math.max(e.start, now))))].slice(0, maxDays);
  if (!events.length) return <p className="text-sm text-muted-foreground">앞으로 {snap.days}일 동안 일정이 없습니다.</p>;
  return (
    <div className="space-y-2">
      {days.map((d) => {
        const list = events.filter((e) => dayKey(Math.max(e.start, now)) === d);
        return (
          <div key={d}>
            <div className="text-xs font-medium text-muted-foreground">{dayLabel(Math.max(list[0].start, now), now)}</div>
            <ul className="mt-0.5 space-y-0.5">
              {list.map((e, i) => (
                <li key={i} className="flex items-baseline gap-2 text-sm">
                  <span className="mt-1 size-2 shrink-0 rounded-full" style={{ background: e.color || "currentColor" }} />
                  <span className="w-16 shrink-0 text-xs text-muted-foreground">{e.allDay ? "하루 종일" : hm(e.start)}</span>
                  <span className="truncate" title={[e.title, e.location, e.calendar].filter(Boolean).join(" · ")}>
                    {e.title}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
