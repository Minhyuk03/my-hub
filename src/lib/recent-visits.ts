/** 이 브라우저에서 최근 연 항목 (⌘K 빈 화면에 보여 줌). 브라우저 저장소가 막혀 있으면 조용히 비운다 */
export type Visit = { id: number; title: string; path: string; sourceKind: string };

const KEY = "hub.recentVisits";
const MAX = 8;

export function readVisits(): Visit[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? (v as Visit[]).filter((x) => typeof x?.id === "number").slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function rememberVisit(v: Visit) {
  try {
    localStorage.setItem(KEY, JSON.stringify([v, ...readVisits().filter((x) => x.id !== v.id)].slice(0, MAX)));
  } catch {}
}
