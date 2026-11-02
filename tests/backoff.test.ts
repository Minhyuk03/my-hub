import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { trimLog } from "@/server/logs";
import { ScanBackoff } from "@/server/sync/backoff";
import { tmpDir } from "./helpers";

describe("클라우드 소스 실패 간격", () => {
  it("실패할 때마다 1분 → 5분 → 30분 → 6시간 기다린다", () => {
    const b = new ScanBackoff();
    expect(b.waiting(1, 0)).toBe(false);
    b.record(1, "offline", 0);
    expect(b.waiting(1, 59_000)).toBe(true);
    expect(b.waiting(1, 60_000)).toBe(false);
    b.record(1, "offline", 60_000);
    expect(b.waiting(1, 60_000 + 4 * 60_000)).toBe(true);
    expect(b.waiting(1, 60_000 + 5 * 60_000)).toBe(false);
    b.record(1, "error", 0);
    b.record(1, "error", 0);
    b.record(1, "error", 0);
    expect(b.waiting(1, 5 * 3600_000)).toBe(true);
    expect(b.waiting(1, 6 * 3600_000)).toBe(false);
  });

  it("성공·직접 요청은 초기화하고, 중단은 세지 않는다", () => {
    const b = new ScanBackoff();
    b.record(1, "aborted", 0);
    expect(b.waiting(1, 1)).toBe(false);
    b.record(1, "offline", 0);
    b.record(2, "offline", 0);
    b.reset(1);
    expect(b.waiting(1, 1)).toBe(false);
    expect(b.waiting(2, 1)).toBe(true);
    b.record(2, "ok", 1);
    expect(b.waiting(2, 2)).toBe(false);
  });
});

describe("로그 정리", () => {
  it("한도를 넘으면 끝부분만 .1 에 남기고 비운다", () => {
    const file = path.join(tmpDir(), "worker.log");
    fs.writeFileSync(file, "a".repeat(90) + "b".repeat(10));
    expect(trimLog(file, 200, 10)).toBe(false);
    expect(trimLog(file, 50, 10)).toBe(true);
    expect(fs.statSync(file).size).toBe(0);
    expect(fs.readFileSync(`${file}.1`, "utf8")).toBe("b".repeat(10));
    expect(trimLog(path.join(path.dirname(file), "none.log"))).toBe(false);
  });
});
