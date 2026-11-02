import { RETRY_DELAYS_MS } from "./scanner";

/**
 * 클라우드 소스 전체 스캔 실패 간격 늘리기.
 * 토큰 만료처럼 계속 실패하는 소스는 lastFullScanAt 이 바뀌지 않아 매번 "확인할 때"가 된다.
 * 실패할 때마다 1분 → 5분 → 30분 → 6시간 (항목 재시도와 같은 간격) 을 기다린 뒤 다시 시도한다.
 */
export class ScanBackoff {
  private fails = new Map<number, { count: number; at: number }>();
  constructor(private delays = RETRY_DELAYS_MS) {}

  /** 스캔 결과를 기록. 성공하면 초기화, 중단(aborted)은 세지 않는다 */
  record(sourceId: number, result: string, now: number) {
    if (result === "ok") this.fails.delete(sourceId);
    else if (result === "offline" || result === "error") {
      const count = (this.fails.get(sourceId)?.count ?? 0) + 1;
      this.fails.set(sourceId, { count, at: now });
    }
  }

  /** 다음 자동 시도까지 기다려야 하면 true */
  waiting(sourceId: number, now: number) {
    const f = this.fails.get(sourceId);
    if (!f) return false;
    return now - f.at < this.delays[Math.min(f.count, this.delays.length) - 1];
  }

  /** 다시 연결·직접 다시 확인처럼 사용자가 요청하면 바로 시도할 수 있게 */
  reset(sourceId?: number) {
    if (sourceId === undefined) this.fails.clear();
    else this.fails.delete(sourceId);
  }
}
