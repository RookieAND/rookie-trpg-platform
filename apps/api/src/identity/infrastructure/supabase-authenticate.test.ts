import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { createJwtVerifier } from "./jwt-verifier";
import { supabaseAuthenticate } from "./supabase-authenticate";

const SECRET = "test-secret-test-secret-test-secret";
const NOW = 1_000_000;
const sign = (payload: object, secret = SECRET, alg = "HS256") => {
  const h = Buffer.from(JSON.stringify({ alg, typ: "JWT" })).toString("base64url");
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const s = createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
};
const good = { sub: "u-1", exp: NOW + 60, user_metadata: { full_name: "윤서하", custom_claims: { global_name: "서하" } } };
const req = (headers: Record<string, string> = {}) => ({ headers }) as unknown as IncomingMessage;
const url = (qs = "") => new URL(`http://x/ws?${qs}`);
const verify = (o: Parameters<typeof createJwtVerifier>[0] = {}) => createJwtVerifier({ hsSecret: SECRET, now: () => NOW, ...o });

describe("HS256 검증", () => {
  it("올바른 토큰을 받는다", async () => expect((await verify()(sign(good)))?.sub).toBe("u-1"));
  it("서명이 다르면 거절한다", async () => expect(await verify()(sign(good, "other-secret-other-secret-other!!"))).toBeNull());
  it("만료된 토큰을 거절한다", async () => expect(await verify()(sign({ ...good, exp: NOW - 10 }))).toBeNull());
  it("exp나 sub가 없으면 거절한다", async () => {
    expect(await verify()(sign({ sub: "u" }))).toBeNull();
    expect(await verify()(sign({ exp: NOW + 1 }))).toBeNull();
  });
  it("alg가 none이거나 서명이 비어 있으면 거절한다", async () => {
    expect(await verify()(sign(good, SECRET, "none"))).toBeNull();
    const [h, p] = sign(good).split(".");
    expect(await verify()(`${h}.${p}.`)).toBeNull();
  });
  it("secret이 없으면 HS256 토큰은 받지 않는다", async () => {
    expect(await verify({ hsSecret: undefined })(sign(good))).toBeNull();
  });
  it("깨진 토큰은 던지지 않고 null", async () => {
    expect(await verify()("abc")).toBeNull();
    expect(await verify()("a.b.c")).toBeNull();
  });
  it("audience와 issuer를 설정하면 맞는 토큰만 받는다", async () => {
    const v = verify({ audience: "authenticated", issuer: "https://p.supabase.co/auth/v1" });
    const ok = { ...good, aud: "authenticated", iss: "https://p.supabase.co/auth/v1" };
    expect(await v(sign(ok))).not.toBeNull();
    expect(await v(sign({ ...ok, aud: ["other", "authenticated"] }))).not.toBeNull();
    expect(await v(sign({ ...ok, aud: "anon" }))).toBeNull();
    expect(await v(sign({ ...ok, iss: "https://evil.example/auth/v1" }))).toBeNull();
    expect(await v(sign(good))).toBeNull();
  });
});

describe("supabaseAuthenticate", () => {
  const auth = supabaseAuthenticate(verify());
  it("Bearer 헤더에서 신원을 읽고, 이름은 디스코드 표시 이름을 쓴다", async () => {
    expect(await auth(req({ authorization: `Bearer ${sign(good)}` }), url())).toEqual({ userId: "u-1", name: "서하", requestedRole: "pl", expiresAt: good.exp * 1000 });
  });
  it("웹소켓은 token 쿼리로 받는다", async () => {
    expect((await auth(req(), url(`token=${sign(good)}&role=kp`)))?.requestedRole).toBe("kp");
  });
  it("토큰이 없거나 틀리면 null", async () => {
    expect(await auth(req(), url())).toBeNull();
    expect(await auth(req({ authorization: "Bearer nope" }), url())).toBeNull();
  });
  it("개발용 user 쿼리로는 우회할 수 없다", async () => {
    expect(await auth(req(), url("user=kp1&name=x"))).toBeNull();
  });
});
