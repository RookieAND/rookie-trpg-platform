import { createHmac, createPublicKey, timingSafeEqual, verify as cryptoVerify, type JsonWebKey, type KeyObject } from "node:crypto";

/**
 * Supabase 액세스 토큰(JWT) 검증기.
 * - HS256: 프로젝트의 JWT Secret(대칭키)
 * - ES256 / RS256: 비대칭 서명 키. `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`의 공개키로 검증한다.
 * 토큰 헤더의 alg로 방식을 고르고, 설정에 없는 방식(none 포함)은 모두 거절한다. 어떤 실패든 던지지 않고 null을 돌려준다.
 */

import { log } from "../../platform/log";

export interface Claims {
  sub?: string;
  exp?: number;
  nbf?: number;
  iss?: string;
  aud?: string | string[];
  role?: string;
  user_metadata?: { full_name?: string; name?: string; user_name?: string; custom_claims?: { global_name?: string } };
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface VerifierOptions {
  /** HS256용 비밀 값 */
  hsSecret?: string;
  /** 비대칭 키를 가져올 JWKS 주소. 보통 `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` */
  jwksUrl?: string;
  /** 있으면 iss가 이 값과 같아야 한다. 보통 `${SUPABASE_URL}/auth/v1` */
  issuer?: string;
  /** 있으면 aud에 이 값이 들어 있어야 한다. Supabase 로그인 토큰은 "authenticated" */
  audience?: string;
  fetch?: FetchLike;
  now?: () => number;
  /** 가져온 키를 믿고 쓰는 시간(ms). 기본 10분 */
  jwksTtlMs?: number;
  /** 모르는 kid가 나왔을 때 다시 가져오기 전 최소 간격(ms). 가짜 kid로 계속 두드리는 것을 막는다. 기본 30초 */
  jwksCooldownMs?: number;
  /** JWKS 요청 제한 시간(ms). 기본 3초 */
  jwksTimeoutMs?: number;
  /** 실패를 알릴 곳(비밀 값 없이 짧은 문장만 넘긴다). 기본은 구조화 로그(warn) */
  warn?: (msg: string) => void;
  /** 시계 오차 허용(초). 기본 5 */
  clockToleranceSec?: number;
}

const b64 = (s: string) => Buffer.from(s, "base64url");
const json = <T>(s: string) => JSON.parse(b64(s).toString("utf8")) as T;

interface Jwk extends JsonWebKey {
  kid?: string;
  use?: string;
  alg?: string;
}

/** kid → 공개키 캐시를 들고 JWKS를 가져오는 쪽. 같은 요청이 겹치면 한 번만 가져온다. */
export class JwksCache {
  private keys = new Map<string, { key: KeyObject; alg?: string }>();
  private fetchedAt = 0;
  private lastAttempt = -Infinity;
  private inflight: Promise<void> | null = null;
  private readonly ttl: number;
  private readonly cooldown: number;
  private readonly timeout: number;
  private readonly now: () => number;
  private readonly doFetch: FetchLike;

  constructor(
    private readonly url: string,
    private readonly opts: Pick<VerifierOptions, "fetch" | "now" | "jwksTtlMs" | "jwksCooldownMs" | "jwksTimeoutMs" | "warn"> = {},
  ) {
    this.ttl = opts.jwksTtlMs ?? 10 * 60_000;
    this.cooldown = opts.jwksCooldownMs ?? 30_000;
    this.timeout = opts.jwksTimeoutMs ?? 3000;
    this.now = opts.now ? () => opts.now!() * 1000 : Date.now;
    this.doFetch = opts.fetch ?? ((u, init) => fetch(u, init));
  }

  /**
   * kid에 맞는 키. 캐시에 있고 신선하면 바로, 없거나 오래됐으면 가져온다.
   * 가져오기가 실패하면 오래된 캐시라도 쓴다(Supabase가 잠깐 안 돼도 로그인한 사람이 튕기지 않게).
   */
  async get(kid: string | undefined): Promise<{ key: KeyObject; alg?: string } | null> {
    const t = this.now();
    const fresh = t - this.fetchedAt < this.ttl;
    const hit = kid !== undefined ? this.keys.get(kid) : this.keys.size === 1 ? [...this.keys.values()][0] : undefined;
    if (hit && fresh) return hit;
    // 오래됐거나(만료) 모르는 kid(키 교체)면 다시 가져온다. 단, 너무 자주는 안 한다.
    if (this.inflight || t - this.lastAttempt >= this.cooldown) await this.refresh();
    return (kid !== undefined ? this.keys.get(kid) : this.keys.size === 1 ? [...this.keys.values()][0] : undefined) ?? null;
  }

  private refresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.lastAttempt = this.now();
    this.inflight = this.load()
      .catch((e) => this.opts.warn?.(`JWKS를 가져오지 못했어요: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  private async load() {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeout);
    try {
      const res = await this.doFetch(this.url, { signal: ctl.signal, headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { keys?: Jwk[] };
      if (!body || !Array.isArray(body.keys)) throw new Error("keys 목록이 없어요");
      const next = new Map<string, { key: KeyObject; alg?: string }>();
      for (const jwk of body.keys) {
        if (!jwk || typeof jwk !== "object" || !jwk.kid || (jwk.use && jwk.use !== "sig")) continue;
        if (jwk.kty !== "EC" && jwk.kty !== "RSA") continue;
        try {
          next.set(jwk.kid, { key: createPublicKey({ key: jwk, format: "jwk" }), alg: jwk.alg });
        } catch {
          /* 읽을 수 없는 키는 건너뛴다 */
        }
      }
      if (next.size === 0) throw new Error("쓸 수 있는 키가 없어요");
      this.keys = next;
      this.fetchedAt = this.now();
    } finally {
      clearTimeout(timer);
    }
  }

  /** 시험·진단용 */
  get size() {
    return this.keys.size;
  }
}

export type VerifyToken = (token: string) => Promise<Claims | null>;

export function createJwtVerifier(opts: VerifierOptions): VerifyToken {
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const tol = opts.clockToleranceSec ?? 5;
  const warn = opts.warn ?? ((m) => log.warn(`[auth] ${m}`));
  const jwks = opts.jwksUrl ? new JwksCache(opts.jwksUrl, { ...opts, warn }) : null;

  const claimsOk = (c: Claims): boolean => {
    const t = now();
    if (typeof c.exp !== "number" || c.exp + tol <= t) return false;
    if (c.nbf !== undefined && (typeof c.nbf !== "number" || c.nbf - tol > t)) return false;
    if (!c.sub || typeof c.sub !== "string") return false;
    if (opts.issuer && c.iss !== opts.issuer) return false;
    if (opts.audience) {
      const aud = Array.isArray(c.aud) ? c.aud : c.aud !== undefined ? [c.aud] : [];
      if (!aud.includes(opts.audience)) return false;
    }
    return true;
  };

  return async (token) => {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;
      const [h, p, s] = parts as [string, string, string];
      const header = json<{ alg?: string; kid?: string }>(h);
      const signed = Buffer.from(`${h}.${p}`);
      const sig = b64(s);
      let valid = false;
      if (header.alg === "HS256") {
        if (!opts.hsSecret) return null;
        const expected = createHmac("sha256", opts.hsSecret).update(signed).digest();
        valid = sig.length === expected.length && timingSafeEqual(sig, expected);
      } else if (header.alg === "ES256" || header.alg === "RS256") {
        if (!jwks) return null;
        const found = await jwks.get(header.kid);
        if (!found) return null;
        // 키가 선언한 alg가 있으면 토큰과 같아야 한다. 키 종류도 alg와 맞아야 한다.
        if (found.alg && found.alg !== header.alg) return null;
        const kty = found.key.asymmetricKeyType;
        if (header.alg === "ES256" ? kty !== "ec" : kty !== "rsa") return null;
        valid =
          header.alg === "ES256"
            ? cryptoVerify("sha256", signed, { key: found.key, dsaEncoding: "ieee-p1363" }, sig)
            : cryptoVerify("sha256", signed, found.key, sig);
      } else {
        return null; // none, HS384, 그 밖의 알고리즘은 받지 않는다.
      }
      if (!valid) return null;
      const claims = json<Claims>(p);
      return claimsOk(claims) ? claims : null;
    } catch {
      return null;
    }
  };
}
