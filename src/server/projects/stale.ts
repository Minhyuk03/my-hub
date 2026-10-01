/**
 * 오래 쉬고 있는 프로젝트 알림: "진행중"인데 연결된 파일이 N일 넘게 바뀌지 않은 프로젝트
 * "알리지 않기"를 누르면 그 뒤 N일 동안 다시 띄우지 않는다 (settings.staleSnooze)
 */
import type { Db } from "../db";
import { getSettings, setSetting } from "../settings";
import { projectList, updateProject } from "./index";

export function staleProjects(db: Db, now = Date.now()) {
  const s = getSettings(db);
  const days = s.staleProjectDays;
  if (!days) return [];
  const cut = now - days * 86400_000;
  return projectList(db, "active")
    .filter((p) => p.itemCount > 0)
    .map((p) => ({ ...p, last: p.lastModified ?? p.updatedAt }))
    .filter((p) => p.last < cut && (s.staleSnooze[String(p.id)] ?? 0) < now)
    .sort((a, b) => a.last - b.last)
    .map((p) => ({ id: p.id, name: p.name, last: p.last, idleDays: Math.floor((now - p.last) / 86400_000) }));
}

export function snoozeStale(db: Db, projectId: number, now = Date.now()) {
  const s = getSettings(db);
  const snooze = Object.fromEntries(Object.entries(s.staleSnooze).filter(([, until]) => until > now));
  snooze[String(projectId)] = now + s.staleProjectDays * 86400_000;
  setSetting(db, "staleSnooze", snooze);
}

export function resolveStale(db: Db, projectId: number, status: "on_hold" | "done") {
  updateProject(db, projectId, { status });
}
