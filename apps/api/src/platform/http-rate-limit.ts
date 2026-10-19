import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ClientIpResolver } from "../identity/application/client-ip";
import { log } from "./log";

/**
 * 모든 REST 요청에 거는 속도 제한(토큰 버킷). 두 겹이다.
 *  - IP별: 소켓 주소(TRUST_PROXY가 1 이상이면 프록시가 붙인 X-Forwarded-For)로 센다.
 *  - 로그인 토큰별: Authorization 머리글(또는 ?token=) 전체를 해시해 센다. 남의 토큰은 알 수 없으니 남의 몫을 깎을 수 없다.
 * /health·/ready는 호스트의 점검이 막히면 안 되므로 제외한다. 웹소켓 연결은 별도(연결 수 제한)로 다룬다.
 */
export interface HttpRateOptions {
  enabled: boolean;
  /** IP 하나가 1분에 보낼 수 있는 요청 수(오래 평균). 순간 폭주는 이 값의 1/4까지 받아 준다. */
  ipPerMin: number;
  /** 로그인 토큰 하나가 1분에 보낼 수 있는 요청 수 */
  userPerMin: number;
}

export const DEFAULT_HTTP_RATE: HttpRateOptions = { enabled: true, ipPerMin: 1800, userPerMin: 900 };

interface Bucket {
  tokens: number;
  last: number;
}

const MAX_KEYS = 50_000;

/** 키마다 토큰 버킷을 두고, 오래 쓰지 않아 가득 찬 것은 지운다. */
export class BucketMap {
  private readonly map = new Map<string, Bucket>();
  private lastSweep = 0;

  constructor(
    private readonly perMin: number,
    private readonly now: () => number,
  ) {}

  private get burst() {
    return Math.max(20, Math.ceil(this.perMin / 4));
  }

  /** 한 번 쓴다. 허락되면 0, 아니면 다시 시도할 때까지 기다릴 ms. */
  take(key: string): number {
    const t = this.now();
    this.sweep(t);
    const perMs = this.perMin / 60_000;
    let b = this.map.get(key);
    if (!b) {
      if (this.map.size >= MAX_KEYS) this.map.delete(this.map.keys().next().value as string);
      b = { tokens: this.burst, last: t };
      this.map.set(key, b);
    }
    b.tokens = Math.min(this.burst, b.tokens + (t - b.last) * perMs);
    b.last = t;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return 0;
    }
    return Math.ceil((1 - b.tokens) / perMs);
  }

  private sweep(t: number) {
    if (t - this.lastSweep < 60_000) return;
    this.lastSweep = t;
    const perMs = this.perMin / 60_000;
    for (const [k, b] of this.map) if (b.tokens + (t - b.last) * perMs >= this.burst) this.map.delete(k);
  }

  size() {
    return this.map.size;
  }
}

const EXEMPT = new Set(["/health", "/ready"]);

const tokenKey = (req: IncomingMessage): string | null => {
  const h = req.headers.authorization;
  const raw = (Array.isArray(h) ? h[0] : h) ?? "";
  let secret = raw;
  if (!secret) {
    try {
      secret = new URL((req as { originalUrl?: string }).originalUrl ?? req.url ?? "/", "http://localhost").searchParams.get("token") ?? "";
    } catch {
      secret = "";
    }
  }
  if (!secret) {
    // 개발용 인증(x-dev-user)이면 그 이름으로 센다.
    const dev = req.headers["x-dev-user"];
    secret = (Array.isArray(dev) ? dev[0] : dev) ?? "";
  }
  return secret ? createHash("sha256").update(secret).digest("base64url").slice(0, 22) : null;
};

export function createHttpRateLimiter(opts: HttpRateOptions, ips: ClientIpResolver, trustProxyHops: number, now: () => number = Date.now) {
  const byIp = new BucketMap(opts.ipPerMin, now);
  const byUser = new BucketMap(opts.userPerMin, now);
  let warnedProxy = false;
  return (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
    if (!opts.enabled) return next();
    const path = ((req as { originalUrl?: string }).originalUrl ?? req.url ?? "").split("?")[0] ?? "";
    if (EXEMPT.has(path)) return next();
    if (!warnedProxy && trustProxyHops === 0 && req.headers["x-forwarded-for"]) {
      warnedProxy = true;
      log.warn("X-Forwarded-For가 붙은 요청이 와요. 프록시 뒤라면 TRUST_PROXY를 프록시 겹 수(보통 1)로 설정하세요. 지금은 모든 사용자가 같은 IP로 세어져요.");
    }
    const wait = Math.max(byIp.take(ips.of(req)), (() => {
      const k = tokenKey(req);
      return k ? byUser.take(k) : 0;
    })());
    if (wait === 0) return next();
    res.statusCode = 429;
    res.setHeader("retry-after", String(Math.max(1, Math.ceil(wait / 1000))));
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ statusCode: 429, message: "요청이 너무 많아요. 잠시 뒤에 다시 해 주세요." }));
  };
}
