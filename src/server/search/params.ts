import type { ItemKind } from "../extract";
import type { SearchFilters } from "./query";

type Params = { get(k: string): string | null; getAll(k: string): string[] };

export const DATE_RANGES: Record<string, { label: string; ms: number }> = {
  "1d": { label: "오늘", ms: 86400_000 },
  "7d": { label: "1주", ms: 7 * 86400_000 },
  "30d": { label: "1달", ms: 30 * 86400_000 },
  "365d": { label: "1년", ms: 365 * 86400_000 },
};

/** URL 검색 조건 → 필터. 페이지와 API가 같은 규칙을 쓴다. */
export function parseFilters(sp: Params): SearchFilters {
  const sourceIds = sp.getAll("source").map(Number).filter(Boolean);
  const kinds = sp.getAll("kind") as ItemKind[];
  const range = sp.get("date");
  return {
    sourceIds: sourceIds.length ? sourceIds : undefined,
    kinds: kinds.length ? kinds : undefined,
    modifiedAfter: range && DATE_RANGES[range] ? Date.now() - DATE_RANGES[range].ms : undefined,
    tag: sp.get("tag") || undefined,
  };
}

/** Next.js searchParams 객체를 Params 모양으로 */
export function fromRecord(r: Record<string, string | string[] | undefined>): Params {
  return {
    get: (k) => {
      const v = r[k];
      return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
    },
    getAll: (k) => {
      const v = r[k];
      return Array.isArray(v) ? v : v ? [v] : [];
    },
  };
}
