/** 한국어 검색 B2 방식의 텍스트 처리 (docs/phase0-korean-search.md) */

export const nfc = (s: string) => s.normalize("NFC");

/** 글자·숫자 연속을 한 토큰으로 본다. NFC + 소문자. */
export function tokenize(s: string): string[] {
  return nfc(s).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** 2글자 보조 색인용: 토큰마다 겹치는 2글자 조각을 만든다. "주간회의록" → 주간 간회 회의 의록 */
export function toBigrams(s: string): string {
  const out = new Set<string>();
  for (const t of tokenize(s)) {
    for (let i = 0; i + 2 <= t.length; i++) out.add(t.slice(i, i + 2));
  }
  return [...out].join(" ");
}

/** FTS5 MATCH 문자열용 인용 */
export const quote = (t: string) => `"${t.replace(/"/g, '""')}"`;
