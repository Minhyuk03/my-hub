/**
 * 앱 아이콘 그림: 가운데 점(허브)에 바깥 점 5개가 이어진 그래프 모양 (글꼴 없이 도형만, next/og 로 그린다)
 * - 바탕은 AI 로고처럼 그라데이션, 점마다 색이 다르고 선은 가운데(흰색)에서 바깥 점 색으로 번진다
 * - 바깥 점끼리도 몇 군데 이어서 그래프처럼 보이게 한다
 */
export const ICON_BG = "linear-gradient(135deg, #1e1b4b 0%, #4338ca 45%, #c026d3 100%)";
/** 바깥 점 색 (위에서부터 시계 방향) */
export const NODE_COLORS = ["#22d3ee", "#a3e635", "#fbbf24", "#fb7185", "#c4b5fd"];
/** 바깥 점끼리 잇는 선 (점 번호 쌍) */
const RING: [number, number][] = [
  [0, 1],
  [2, 3],
  [3, 4],
];

export function HubIcon({ size, rounded = true, background = ICON_BG }: { size: number; rounded?: boolean; background?: string }) {
  const small = size < 64;
  const c = size / 2;
  const r = size * 0.3; // 바깥 점이 놓이는 원의 반지름
  const dot = Math.max(4, Math.round(size * (small ? 0.17 : 0.13)));
  const center = Math.max(6, Math.round(size * (small ? 0.24 : 0.2)));
  const line = Math.max(2, Math.round(size * (small ? 0.05 : 0.03)));
  const spots = NODE_COLORS.map((color, i) => {
    const a = ((-90 + i * 72) * Math.PI) / 180;
    return { x: c + r * Math.cos(a), y: c + r * Math.sin(a), color };
  });
  // 두 점 사이 선: 가운데를 두 점의 가운데에 두고 제자리에서 돌린다
  const edge = (x1: number, y1: number, x2: number, y2: number, bg: string, w: number, opacity = 1, key = "") => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ang = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
    return (
      <div
        key={key}
        style={{ position: "absolute", left: (x1 + x2) / 2 - len / 2, top: (y1 + y2) / 2 - w / 2, width: len, height: w, borderRadius: w, background: bg, opacity, transform: `rotate(${ang}deg)` }}
      />
    );
  };
  // next/og 는 boxShadow 에 undefined 를 받지 않으므로, 작은 아이콘에서는 키 자체를 뺀다
  const glow = (color: string, d: number) => (small ? {} : { boxShadow: `0 0 ${Math.round(d * 0.6)}px ${color}` });
  return (
    <div style={{ width: size, height: size, display: "flex", position: "relative", background, borderRadius: rounded ? size * 0.22 : 0 }}>
      {/* 바깥 점끼리 (작은 아이콘에서는 뭉개지므로 뺀다) */}
      {!small &&
        RING.map(([a, b]) =>
          edge(spots[a].x, spots[a].y, spots[b].x, spots[b].y, `linear-gradient(90deg, ${spots[a].color}, ${spots[b].color})`, Math.max(1, Math.round(line * 0.6)), 0.55, `r${a}${b}`),
        )}
      {/* 가운데 → 바깥 점: 흰색에서 점 색으로 */}
      {spots.map((s, i) => edge(c, c, s.x, s.y, `linear-gradient(90deg, rgba(255,255,255,0.95), ${s.color})`, line, 1, `l${i}`))}
      {spots.map((s, i) => (
        <div key={`d${i}`} style={{ position: "absolute", left: s.x - dot / 2, top: s.y - dot / 2, width: dot, height: dot, borderRadius: dot, background: s.color, ...glow(s.color, dot) }} />
      ))}
      <div style={{ position: "absolute", left: c - center / 2, top: c - center / 2, width: center, height: center, borderRadius: center, background: "white", ...glow("rgba(255,255,255,0.8)", center) }} />
    </div>
  );
}
