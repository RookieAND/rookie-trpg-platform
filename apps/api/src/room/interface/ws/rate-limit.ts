/** 연결 하나의 메시지 속도 제한. 토큰 버킷이라 짧은 폭주는 받아 주고, 계속 넘치면 끊는다. */
export interface RateLimitOptions {
  /** 한꺼번에 받아 줄 수 있는 메시지 수 */
  burst: number;
  /** 초당 채워지는 수 */
  perSec: number;
  /** strikeWindowMs 안에 거절이 이만큼 쌓이면 연결을 닫는다 */
  maxStrikes: number;
  strikeWindowMs: number;
}

/** 토큰 이동은 놓을 때 한 번만 보내므로 정상 플레이는 초당 몇 건이다. 그보다 훨씬 넉넉하게 잡는다. */
export const DEFAULT_RATE_LIMIT: RateLimitOptions = { burst: 120, perSec: 60, maxStrikes: 100, strikeWindowMs: 10_000 };

export type RateVerdict = "ok" | "reject" | "close";

export class MessageRateLimiter {
  private tokens: number;
  private last: number;
  private strikes = 0;
  private strikeSince = 0;

  constructor(
    private readonly opts: RateLimitOptions,
    private readonly now: () => number,
  ) {
    this.tokens = opts.burst;
    this.last = now();
  }

  take(): RateVerdict {
    const t = this.now();
    this.tokens = Math.min(this.opts.burst, this.tokens + ((t - this.last) / 1000) * this.opts.perSec);
    this.last = t;
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return "ok";
    }
    if (t - this.strikeSince > this.opts.strikeWindowMs) {
      this.strikeSince = t;
      this.strikes = 0;
    }
    this.strikes += 1;
    return this.strikes >= this.opts.maxStrikes ? "close" : "reject";
  }
}
