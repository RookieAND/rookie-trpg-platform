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
  it("시크릿이 있으면 ALLOW_DEV_AUTH가 있어도 supabase만 쓴다", () => {
    const c = loadConfig({ NODE_ENV: "production", SUPABASE_JWT_SECRET: "s".repeat(32), ALLOW_DEV_AUTH: "1" });
    expect(c.authMode).toBe("supabase");
    expect(c.warnings.join("\n")).toMatch(/무시/);
    // x-dev-user만으로는 신원이 되지 않는다.
    expect(authenticateFor(c)(req({ "x-dev-user": "하늘" }), new URL("http://x/rooms"))).toBeNull();
  });
  it("개발 환경은 시크릿이 없어도 뜨고 경고를 남긴다", () => {
    const c = loadConfig({});
    expect(c.authMode).toBe("dev");
    expect(c.warnings.length).toBe(1);
    expect(authenticateFor(c)(req({ "x-dev-user": "u1" }), new URL("http://x/rooms"))?.userId).toBe("u1");
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
