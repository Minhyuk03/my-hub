import fs from "node:fs";

/**
 * launchd 로그 파일이 maxBytes 를 넘으면 끝부분 keepBytes 만 <파일>.1 에 남기고 비운다.
 * launchd 는 파일을 이어쓰기(O_APPEND)로 열어 두므로 이름을 바꾸지 않고 비워야 계속 같은 파일에 쓴다.
 */
export function trimLog(file: string, maxBytes = 20 * 1024 * 1024, keepBytes = 5 * 1024 * 1024): boolean {
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return false;
  }
  if (size <= maxBytes) return false;
  const keep = Math.min(keepBytes, size);
  const buf = Buffer.alloc(keep);
  const fd = fs.openSync(file, "r");
  try {
    fs.readSync(fd, buf, 0, keep, size - keep);
  } finally {
    fs.closeSync(fd);
  }
  fs.writeFileSync(`${file}.1`, buf);
  fs.truncateSync(file, 0);
  return true;
}
