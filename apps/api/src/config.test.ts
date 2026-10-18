import { describe, expect, it } from "vitest";
import { ConfigError, authenticateFor, loadConfig } from "./config";
import type { IncomingMessage } from "node:http";

const req = (headers: Record<string, string> = {}) => ({ headers }) as unknown as IncomingMessage;

describe("loadConfig 인증 설정", () => {
  it("production에서 시크릿이 없으면 부팅을 거부한다", () => {
    expect(() => loadConfig({ NODE_ENV: "production" })).toThrow(ConfigError);
    expect(() => loadConfig({ NODE_ENV: "production", SUPABASE_JWT_SECRET: "   " })).toThrow(/SUPABASE_JWT_SECRET/);
  });
  it("production에서 시크릿이 있으면 supabase 모드다", () => {
    const c = loadConfig({ NODE_ENV: "production", SUPABASE_JWT_SECRET: "s".repeat(32), WEB_ORIGIN: "https://x.app", DATABASE_URL: "postgres://x" });
    expect(c.authMode).toBe("supabase");
    expect(c.warnings).toEqual([]);
  });
  it("production에서 ALLOW_DEV_AUTH=1이면 개발용으로 뜨되 경고한다", () => {
    const c = loadConfig({ NODE_ENV: "production", ALLOW_DEV_AUTH: "1" });
    expect(c.authMode).toBe("dev");
    expect(c.warnings.join("\n")).toMatch(/ALLOW_DEV_AUTH=1/);
  });
  it("시크릿이 있으면 ALLOW_DEV_AUTH가 있어도 supabase만 쓴다", async () => {
    const c = loadConfig({ NODE_ENV: "production", SUPABASE_JWT_SECRET: "s".repeat(32), ALLOW_DEV_AUTH: "1" });
    expect(c.authMode).toBe("supabase");
    expect(c.warnings.join("\n")).toMatch(/무시/);
    // x-dev-user만으로는 신원이 되지 않는다.
    expect(await authenticateFor(c)(req({ "x-dev-user": "하늘" }), new URL("http://x/rooms"))).toBeNull();
    expect(await authenticateFor(c)(req(), new URL("http://x/ws?user=하늘&name=x"))).toBeNull();
  });
  it("개발 환경은 시크릿이 없어도 뜨고 경고를 남긴다", async () => {
    const c = loadConfig({});
    expect(c.authMode).toBe("dev");
    expect(c.warnings.length).toBe(1);
    expect((await authenticateFor(c)(req({ "x-dev-user": "u1" }), new URL("http://x/rooms")))?.userId).toBe("u1");
  });
  it("production에서 빠진 WEB_ORIGIN과 저장소 설정은 경고한다", () => {
    const c = loadConfig({ NODE_ENV: "production", SUPABASE_JWT_SECRET: "s".repeat(32) });
    expect(c.warnings.length).toBe(2);
  });
  it("PORT와 TRUST_PROXY를 검증한다", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow(ConfigError);
    expect(() => loadConfig({ TRUST_PROXY: "9" })).toThrow(ConfigError);
    expect(loadConfig({ TRUST_PROXY: "1" }).trustProxyHops).toBe(1);
    expect(loadConfig({}).trustProxyHops).toBe(0);
  });
});

describe("loadConfig 비대칭 키(SUPABASE_URL)와 S3", () => {
  it("production에서 SUPABASE_URL만 있어도 supabase 모드로 뜨고 개발용 인증은 막힌다", async () => {
    const c = loadConfig({ NODE_ENV: "production", SUPABASE_URL: "https://abc.supabase.co/", ALLOW_DEV_AUTH: "1", WEB_ORIGIN: "https://x.app", DATABASE_URL: "postgres://x" });
    expect(c.authMode).toBe("supabase");
    expect(c.supabaseUrl).toBe("https://abc.supabase.co");
    expect(c.warnings.join("\n")).toMatch(/무시/);
    expect(await authenticateFor(c)(req({ "x-dev-user": "하늘" }), new URL("http://x/rooms?user=하늘"))).toBeNull();
  });
  it("production에서 SUPABASE_URL도 SUPABASE_JWT_SECRET도 없으면 거절한다", () => {
    expect(() => loadConfig({ NODE_ENV: "production", WEB_ORIGIN: "https://x.app" })).toThrow(/SUPABASE_URL/);
  });
  it("SUPABASE_URL이 이상하면 거절한다", () => {
    expect(() => loadConfig({ SUPABASE_URL: "not a url" })).toThrow(ConfigError);
    expect(() => loadConfig({ SUPABASE_URL: "ftp://x.co" })).toThrow(ConfigError);
  });
  it("S3_BUCKET이 있으면 키도 있어야 하고, R2처럼 endpoint가 있으면 경로 방식을 쓴다", () => {
    expect(() => loadConfig({ S3_BUCKET: "b" })).toThrow(/S3_ACCESS_KEY_ID/);
    const c = loadConfig({ S3_BUCKET: "b", S3_ACCESS_KEY_ID: "id", S3_SECRET_ACCESS_KEY: "sec", S3_ENDPOINT: "https://acct.r2.cloudflarestorage.com", S3_PREFIX: "/img/" });
    expect(c.s3).toMatchObject({ bucket: "b", region: "auto", forcePathStyle: true, prefix: "img" });
    expect(loadConfig({ S3_BUCKET: "b", S3_ACCESS_KEY_ID: "id", S3_SECRET_ACCESS_KEY: "sec", S3_REGION: "ap-northeast-2" }).s3).toMatchObject({ region: "ap-northeast-2", forcePathStyle: false });
    expect(loadConfig({}).s3).toBeUndefined();
  });
});
