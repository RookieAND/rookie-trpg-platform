import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { supabaseAuthenticate, verifyJwt } from "./supabase-authenticate";

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

describe("verifyJwt", () => {
  it("올바른 토큰을 받는다", () => expect(verifyJwt(sign(good), SECRET, NOW)?.sub).toBe("u-1"));
  it("서명이 다르면 거절한다", () => expect(verifyJwt(sign(good, "other-secret-other-secret-other!!"), SECRET, NOW)).toBeNull());
  it("만료된 토큰을 거절한다", () => expect(verifyJwt(sign({ ...good, exp: NOW - 1 }), SECRET, NOW)).toBeNull());
  it("exp나 sub가 없으면 거절한다", () => {
    expect(verifyJwt(sign({ sub: "u" }), SECRET, NOW)).toBeNull();
    expect(verifyJwt(sign({ exp: NOW + 1 }), SECRET, NOW)).toBeNull();
  });
  it("alg가 HS256이 아니면 거절한다", () => {
    expect(verifyJwt(sign(good, SECRET, "none"), SECRET, NOW)).toBeNull();
    const [h, p] = sign(good).split(".");
    expect(verifyJwt(`${h}.${p}.`, SECRET, NOW)).toBeNull();
  });
  it("깨진 토큰은 던지지 않고 null", () => {
    expect(verifyJwt("abc", SECRET, NOW)).toBeNull();
    expect(verifyJwt("a.b.c", SECRET, NOW)).toBeNull();
  });
});

describe("supabaseAuthenticate", () => {
  const auth = supabaseAuthenticate(SECRET, () => NOW);
  it("Bearer 헤더에서 신원을 읽고, 이름은 디스코드 표시 이름을 쓴다", () => {
    expect(auth(req({ authorization: `Bearer ${sign(good)}` }), url())).toEqual({ userId: "u-1", name: "서하", requestedRole: "pl" });
  });
  it("웹소켓은 token 쿼리로 받는다", () => {
    expect(auth(req(), url(`token=${sign(good)}&role=kp`))?.requestedRole).toBe("kp");
  });
  it("토큰이 없거나 틀리면 null", () => {
    expect(auth(req(), url())).toBeNull();
    expect(auth(req({ authorization: "Bearer nope" }), url())).toBeNull();
  });
  it("개발용 user 쿼리로는 우회할 수 없다", () => {
    expect(auth(req(), url("user=kp1&name=x"))).toBeNull();
  });
});
