/**
 * 성능 측정용 합성 문서.
 * 실제 문서처럼 단어 빈도가 고르지 않게(Zipf 분포) 만든다. 검색어로 쓰는 단어는 문서의 일정 비율에만 들어가게 한다.
 */

export function rand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const SYL = "가나다라마바사아자차카타파하거너더러머버서어저처커터퍼허고노도로모보소오조초코토포호구누두루무부수우주추쿠투푸후기니디리미비시이지치키티피히개내대래매배새애재채캐태패해";

/** 한글 음절 조합으로 만든 어휘 (5,000개) */
const VOCAB: string[] = (() => {
  const r = rand(1);
  const out = new Set<string>();
  while (out.size < 5000) {
    const n = 2 + Math.floor(r() * 3);
    let w = "";
    for (let i = 0; i < n; i++) w += SYL[Math.floor(r() * SYL.length)];
    out.add(w);
  }
  return [...out];
})();

/** 검색어로 쓰는 단어와, 그 단어가 들어갈 문서 비율 */
const PLANTED: [string, number][] = [
  ["회의", 0.08],
  ["주간회의록", 0.02],
  ["회의록", 0.03],
  ["프로젝트를", 0.05],
  ["프로젝트에서", 0.04],
  ["노션", 0.04],
  ["동기화", 0.03],
  ["Claude Code", 0.02],
  ["2026년 9월", 0.03],
  ["9월", 0.06],
  ["블로그", 0.02],
  ["리뉴얼", 0.015],
];

const FOLDERS = ["1. Projects/블로그 리뉴얼", "1. Projects/허브", "2. Areas/업무", "3. Resources/개발", "4. Archives/여행", "일정관리/Daily", "Documents/회사", "Desktop"];

function zipf(r: () => number) {
  // 앞쪽 단어일수록 자주 나온다
  return VOCAB[Math.floor(VOCAB.length * Math.pow(r(), 2.5))];
}

export function syntheticDoc(r: () => number, i: number) {
  const len = 150 + Math.floor(r() * 450); // 단어 수 (평균 약 1,500자)
  const w: string[] = [];
  for (let k = 0; k < len; k++) {
    w.push(zipf(r));
    if (r() < 0.08) w.push("\n");
  }
  for (const [word, p] of PLANTED) {
    if (r() < p) w.splice(Math.floor(r() * w.length), 0, word);
  }
  const title = r() < 0.05 ? `${PLANTED[Math.floor(r() * PLANTED.length)][0]} ${zipf(r)} ${i}` : `${zipf(r)} ${zipf(r)} ${i}`;
  return { title, folder: FOLDERS[i % FOLDERS.length], body: w.join(" ") };
}
