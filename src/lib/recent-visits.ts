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

/** 허브에 더는 없는 항목(민감 정보로 숨김·제외·등록 해제)을 이 브라우저 기록에서도 지운다 */
export function keepVisits(ids: Set<number>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(readVisits().filter((x) => ids.has(x.id))));
  } catch {}
}
