/** 앱 아이콘 그림: 가운데 점에 네 점이 이어진 "허브" 모양 (글꼴 없이 도형만) */
export function HubIcon({ size, rounded = true }: { size: number; rounded?: boolean }) {
  const dot = Math.round(size * 0.16);
  const center = Math.round(size * 0.22);
  const off = Math.round(size * 0.27);
  const line = Math.max(2, Math.round(size * 0.035));
  const c = size / 2;
  const spots = [
    [c - off, c - off],
    [c + off, c - off],
    [c - off, c + off],
    [c + off, c + off],
  ];
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        position: "relative",
        background: "linear-gradient(135deg, #4f46e5 0%, #0ea5e9 100%)",
        borderRadius: rounded ? size * 0.22 : 0,
      }}
    >
      {spots.map(([x, y], i) => {
        const len = Math.hypot(x - c, y - c);
        const ang = (Math.atan2(y - c, x - c) * 180) / Math.PI;
        return (
          <div
            key={`l${i}`}
            // 선의 가운데를 두 점의 가운데에 두고 제자리에서 돌린다
            style={{ position: "absolute", left: (c + x) / 2 - len / 2, top: (c + y) / 2 - line / 2, width: len, height: line, background: "rgba(255,255,255,0.7)", transform: `rotate(${ang}deg)` }}
          />
        );
      })}
      {spots.map(([x, y], i) => (
        <div key={`d${i}`} style={{ position: "absolute", left: x - dot / 2, top: y - dot / 2, width: dot, height: dot, borderRadius: dot, background: "white" }} />
      ))}
      <div style={{ position: "absolute", left: c - center / 2, top: c - center / 2, width: center, height: center, borderRadius: center, background: "white" }} />
    </div>
  );
}
