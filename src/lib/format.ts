export function relTime(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return "-";
  const diff = now - ms;
  const min = Math.round(diff / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}일 전`;
  const dt = new Date(ms);
  return dt.getFullYear() === new Date(now).getFullYear()
    ? `${dt.getMonth() + 1}월 ${dt.getDate()}일`
    : `${dt.getFullYear()}. ${dt.getMonth() + 1}. ${dt.getDate()}.`;
}

export function fullDate(ms: number | null | undefined): string {
  if (!ms) return "-";
  return new Date(ms).toLocaleString("ko-KR", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function bytes(n: number | null | undefined): string {
  if (n == null) return "-";
  if (n < 1024) return `${n}B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)}KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)}MB`;
  return `${(n / 1073741824).toFixed(1)}GB`;
}

/** 홈 디렉터리·iCloud 경로를 짧게 */
export function shortPath(p: string): string {
  // Google Drive: "gdrive:/<루트ID>/폴더#ID/파일#ID" → "Google Drive/폴더/파일"
  if (p.startsWith("gdrive:/")) return p.replace(/^gdrive:\/[^/]+/, "Google Drive").replace(/#[A-Za-z0-9_-]+/g, "");
  if (p.startsWith("notion:/")) return p.replace(/^notion:\/[^/]+/, "Notion").replace(/#[A-Za-z0-9_-]+/g, "");
  if (p.startsWith("github:/")) return p.replace(/^github:\/[^/]+/, "GitHub").replace(/#[A-Za-z0-9_-]+/g, "");
  return p
    .normalize("NFC")
    .replace(/^\/Users\/[^/]+\/Library\/Mobile Documents\/iCloud~md~obsidian\/Documents/, "Obsidian")
    .replace(/^\/Users\/[^/]+\/Library\/Mobile Documents\/com~apple~CloudDocs/, "iCloud Drive")
    .replace(/^\/Users\/[^/]+/, "~");
}

export function untilTime(ms: number, now = Date.now()): string {
  const min = Math.round((ms - now) / 60000);
  if (min <= 0) return "곧";
  if (min < 60) return `${min}분 후`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h}시간 후` : `${Math.round(h / 24)}일 후`;
}
