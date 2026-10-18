import { createSign, generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createJwtVerifier, type FetchLike } from "./jwt-verifier";

const NOW = 2_000_000;
const ISS = "https://proj.supabase.co/auth/v1";
const JWKS_URL = "https://proj.supabase.co/auth/v1/.well-known/jwks.json";
const b64 = (o: object | Buffer) => (Buffer.isBuffer(o) ? o : Buffer.from(JSON.stringify(o))).toString("base64url");

interface Pair {
  kid: string;
  alg: "ES256" | "RS256";
  priv: KeyObject;
  jwk: Record<string, unknown>;
}
const ec = (kid: string): Pair => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return { kid, alg: "ES256", priv: privateKey, jwk: { ...publicKey.export({ format: "jwk" }), kid, use: "sig", alg: "ES256" } };
};
const rsa = (kid: string): Pair => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return { kid, alg: "RS256", priv: privateKey, jwk: { ...publicKey.export({ format: "jwk" }), kid, use: "sig", alg: "RS256" } };
};
const mint = (k: Pair, claims: object, header: object = {}) => {
  const h = b64({ alg: k.alg, typ: "JWT", kid: k.kid, ...header });
  const p = b64(claims);
  const data = Buffer.from(`${h}.${p}`);
  const sig = k.alg === "ES256" ? cryptoSign("sha256", data, { key: k.priv, dsaEncoding: "ieee-p1363" }) : createSign("sha256").update(data).sign(k.priv);
  return `${h}.${p}.${b64(sig)}`;
};
const claims = { sub: "u-1", exp: NOW + 7200, iss: ISS, aud: "authenticated" };

/** 가짜 JWKS 서버. keys를 바꾸면 다음 요청부터 바뀐 목록을 준다. */
function fakeJwks(initial: Pair[]) {
  const state = { keys: initial, calls: 0, mode: "ok" as "ok" | "down" | "500" | "garbage" | "hang" };
  const fetch: FetchLike = (url, init) => {
    state.calls += 1;
    expect(url).toBe(JWKS_URL);
    if (state.mode === "down") return Promise.reject(new Error("ECONNREFUSED"));
    if (state.mode === "hang") return new Promise((_, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))));
    if (state.mode === "500") return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
    if (state.mode === "garbage") return Promise.resolve({ ok: true, status: 200, json: async () => ({ nope: 1 }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ keys: state.keys.map((k) => k.jwk) }) });
  };
  return { state, fetch };
}

const make = (jwks: ReturnType<typeof fakeJwks>, over: Parameters<typeof createJwtVerifier>[0] = {}) => {
  let now = NOW;
  const warn = vi.fn();
  const verify = createJwtVerifier({ jwksUrl: JWKS_URL, issuer: ISS, audience: "authenticated", fetch: jwks.fetch, now: () => now, warn, jwksTimeoutMs: 50, ...over });
  return { verify, warn, advance: (s: number) => (now += s) };
};

describe("JWKS 검증 (ES256 / RS256)", () => {
  it("ES256 토큰을 받는다", async () => {
    const k = ec("k1");
    const { verify } = make(fakeJwks([k]));
    expect((await verify(mint(k, claims)))?.sub).toBe("u-1");
  });
  it("RS256 토큰을 받는다", async () => {
    const k = rsa("r1");
    const { verify } = make(fakeJwks([k]));
    expect((await verify(mint(k, claims)))?.sub).toBe("u-1");
  });
  it("키를 캐시해서 요청마다 가져오지 않는다", async () => {
    const k = ec("k1");
    const j = fakeJwks([k]);
    const { verify } = make(j);
    await verify(mint(k, claims));
    await verify(mint(k, claims));
    await verify(mint(k, claims));
    expect(j.state.calls).toBe(1);
  });
  it("동시에 들어온 요청은 JWKS를 한 번만 가져온다", async () => {
    const k = ec("k1");
    const j = fakeJwks([k]);
    const { verify } = make(j);
    const r = await Promise.all([1, 2, 3, 4].map(() => verify(mint(k, claims))));
    expect(r.every(Boolean)).toBe(true);
    expect(j.state.calls).toBe(1);
  });
  it("다른 키로 서명했거나 내용을 바꾸면 거절한다", async () => {
    const k = ec("k1");
    const other = ec("k1"); // 같은 kid, 다른 키
    const { verify } = make(fakeJwks([k]));
    expect(await verify(mint(other, claims))).toBeNull();
    const [h, , s] = mint(k, claims).split(".");
    expect(await verify(`${h}.${b64({ ...claims, sub: "admin" })}.${s}`)).toBeNull();
  });
  it("만료된 토큰을 거절한다", async () => {
    const k = ec("k1");
    const { verify } = make(fakeJwks([k]));
    expect(await verify(mint(k, { ...claims, exp: NOW - 60 }))).toBeNull();
  });
  it("nbf가 아직 미래면 거절한다", async () => {
    const k = ec("k1");
    const { verify } = make(fakeJwks([k]));
    expect(await verify(mint(k, { ...claims, nbf: NOW + 3600 }))).toBeNull();
  });
  it("aud나 iss가 다르면 거절한다", async () => {
    const k = ec("k1");
    const { verify } = make(fakeJwks([k]));
    expect(await verify(mint(k, { ...claims, aud: "anon" }))).toBeNull();
    expect(await verify(mint(k, { ...claims, iss: "https://evil.example/auth/v1" }))).toBeNull();
    expect(await verify(mint(k, { sub: "u", exp: NOW + 60 }))).toBeNull();
  });
  it("alg가 none이거나 서명이 없으면 거절한다", async () => {
    const k = ec("k1");
    const j = fakeJwks([k]);
    const { verify } = make(j);
    const h = b64({ alg: "none", typ: "JWT", kid: "k1" });
    expect(await verify(`${h}.${b64(claims)}.`)).toBeNull();
    expect(await verify(`${h}.${b64(claims)}.${b64(Buffer.from("x"))}`)).toBeNull();
    expect(j.state.calls).toBe(0);
  });
  it("공개키로 HS256 서명을 위조하는 알고리즘 혼동 공격을 막는다", async () => {
    const k = rsa("r1");
    const j = fakeJwks([k]);
    // HS256으로 서명했지만 secret 설정이 없는 서버: 공개키를 비밀로 쓴 위조 토큰도 거절돼야 한다.
    const { verify } = make(j);
    const h = b64({ alg: "HS256", typ: "JWT", kid: "r1" });
    const p = b64(claims);
    const { createHmac } = await import("node:crypto");
    const forged = createHmac("sha256", JSON.stringify(k.jwk)).update(`${h}.${p}`).digest("base64url");
    expect(await verify(`${h}.${p}.${forged}`)).toBeNull();
  });
  it("토큰 alg와 키 종류가 맞지 않으면 거절한다", async () => {
    const e = ec("k1");
    const { verify } = make(fakeJwks([e]));
    // ES256 키로 만든 서명을 RS256이라 우긴다.
    expect(await verify(mint({ ...e, alg: "RS256" }, claims))).toBeNull();
  });
  it("지원하지 않는 알고리즘(HS384 등)은 거절한다", async () => {
    const { verify } = make(fakeJwks([ec("k1")]));
    const h = b64({ alg: "HS384", kid: "k1" });
    expect(await verify(`${h}.${b64(claims)}.${b64(Buffer.from("x"))}`)).toBeNull();
  });
});

describe("키 교체와 장애", () => {
  it("모르는 kid가 나오면 한 번 다시 가져와 새 키로 검증한다(키 교체)", async () => {
    const a = ec("old");
    const b = ec("new");
    const j = fakeJwks([a]);
    const { verify, advance } = make(j);
    expect(await verify(mint(a, claims))).not.toBeNull();
    j.state.keys = [a, b];
    advance(60); // 쿨다운(30초)이 지난 뒤
    expect(await verify(mint(b, claims))).not.toBeNull();
    expect(j.state.calls).toBe(2);
  });
  it("가짜 kid를 계속 보내도 쿨다운 안에서는 다시 가져오지 않는다", async () => {
    const a = ec("k1");
    const j = fakeJwks([a]);
    const { verify } = make(j);
    const fake = ec("nope");
    for (let i = 0; i < 20; i++) expect(await verify(mint(fake, claims))).toBeNull();
    expect(j.state.calls).toBe(1);
  });
  it("회전으로 지워진 옛 kid 토큰은 거절한다", async () => {
    const a = ec("old");
    const b = ec("new");
    const j = fakeJwks([a]);
    const { verify, advance } = make(j);
    await verify(mint(a, claims));
    j.state.keys = [b];
    advance(700); // TTL(10분) 뒤
    expect(await verify(mint(a, claims))).toBeNull();
    expect(await verify(mint(b, claims))).not.toBeNull();
  });
  it("JWKS가 내려가 있으면 던지지 않고 null(401)이다", async () => {
    const k = ec("k1");
    const j = fakeJwks([k]);
    j.state.mode = "down";
    const { verify, warn } = make(j);
    await expect(verify(mint(k, claims))).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls[0]![0]).toContain("JWKS");
  });
  it("JWKS가 500이거나 엉뚱한 본문이어도 null", async () => {
    const k = ec("k1");
    for (const mode of ["500", "garbage"] as const) {
      const j = fakeJwks([k]);
      j.state.mode = mode;
      const { verify } = make(j);
      expect(await verify(mint(k, claims))).toBeNull();
    }
  });
  it("JWKS 응답이 오지 않아도 제한 시간 뒤 null", async () => {
    const k = ec("k1");
    const j = fakeJwks([k]);
    j.state.mode = "hang";
    const { verify } = make(j);
    const t0 = Date.now();
    expect(await verify(mint(k, claims))).toBeNull();
    expect(Date.now() - t0).toBeLessThan(2000);
  });
  it("가져온 적이 있으면 JWKS가 잠깐 죽어도 캐시된 키로 계속 검증한다", async () => {
    const k = ec("k1");
    const j = fakeJwks([k]);
    const { verify, advance } = make(j);
    expect(await verify(mint(k, claims))).not.toBeNull();
    j.state.mode = "down";
    advance(700); // TTL이 지나 새로 가져오려 하지만 실패
    expect(await verify(mint(k, claims))).not.toBeNull();
  });
  it("장애가 풀리면 쿨다운 뒤 다시 가져온다", async () => {
    const k = ec("k1");
    const j = fakeJwks([k]);
    j.state.mode = "down";
    const { verify, advance } = make(j);
    expect(await verify(mint(k, claims))).toBeNull();
    j.state.mode = "ok";
    advance(31);
    expect(await verify(mint(k, claims))).not.toBeNull();
  });
});

describe("방식 선택", () => {
  it("secret과 JWKS를 함께 설정하면 토큰 헤더의 alg로 고른다", async () => {
    const k = ec("k1");
    const { createHmac } = await import("node:crypto");
    const hs = (c: object) => {
      const h = b64({ alg: "HS256", typ: "JWT" });
      const p = b64(c);
      return `${h}.${p}.${createHmac("sha256", "shh-shh-shh-shh-shh-shh-shh-shh").update(`${h}.${p}`).digest("base64url")}`;
    };
    const { verify } = make(fakeJwks([k]), { hsSecret: "shh-shh-shh-shh-shh-shh-shh-shh" });
    expect(await verify(hs(claims))).not.toBeNull();
    expect(await verify(mint(k, claims))).not.toBeNull();
  });
});
