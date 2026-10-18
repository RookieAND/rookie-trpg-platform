import { describe, expect, it, vi } from "vitest";
import { refreshSession, type RefreshDeps } from "./refresh-session";
import type { Identity } from "./identity";
import { sessionFromCallbackHash } from "./discord-login";

const jwt = (payload: object) => `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;
const stored: Identity = { userId: "u-1", name: "서하", token: jwt({ sub: "u-1", exp: 1 }), expiresAt: 1, refreshToken: "r-old" };

const deps = (res: { ok: boolean; status: number; body?: unknown } | Error): RefreshDeps & { fetch: ReturnType<typeof vi.fn> } => ({
  supabaseUrl: "https://x.supabase.co/",
  anonKey: "anon",
  fetch: vi.fn(async () => {
    if (res instanceof Error) throw res;
    return { ok: res.ok, status: res.status, json: async () => res.body };
  }),
});

describe("refreshSession", () => {
  it("갱신 토큰으로 새 세션을 받고, 회전한 갱신 토큰을 돌려준다", async () => {
    const access = jwt({ sub: "u-1", exp: 9999, user_metadata: { full_name: "서하" } });
    const d = deps({ ok: true, status: 200, body: { access_token: access, refresh_token: "r-new" } });
    const r = await refreshSession(stored, d);
    expect(r).toEqual({ status: "ok", identity: { userId: "u-1", name: "서하", token: access, expiresAt: 9999, refreshToken: "r-new" } });
    const [url, init] = d.fetch.mock.calls[0]!;
    expect(url).toBe("https://x.supabase.co/auth/v1/token?grant_type=refresh_token");
    expect(init.headers.apikey).toBe("anon");
    expect(JSON.parse(init.body)).toEqual({ refresh_token: "r-old" });
  });
  it("응답에 갱신 토큰이 없으면 기존 것을 유지한다", async () => {
    const r = await refreshSession(stored, deps({ ok: true, status: 200, body: { access_token: jwt({ sub: "u-1", exp: 9 }) } }));
    expect(r.status === "ok" && r.identity.refreshToken).toBe("r-old");
  });
  it("거절(400/401)이나 갱신 토큰 없음은 invalid", async () => {
    expect((await refreshSession(stored, deps({ ok: false, status: 400 }))).status).toBe("invalid");
    expect((await refreshSession(stored, deps({ ok: false, status: 401 }))).status).toBe("invalid");
    const d = deps({ ok: true, status: 200 });
    expect((await refreshSession({ ...stored, refreshToken: undefined }, d)).status).toBe("invalid");
    expect(d.fetch).not.toHaveBeenCalled();
  });
  it("네트워크 오류·서버 오류는 unreachable(다시 시도할 수 있음)", async () => {
    expect((await refreshSession(stored, deps(new Error("offline")))).status).toBe("unreachable");
    expect((await refreshSession(stored, deps({ ok: false, status: 503 }))).status).toBe("unreachable");
  });
  it("다른 사람의 토큰이나 깨진 응답은 받지 않는다", async () => {
    expect((await refreshSession(stored, deps({ ok: true, status: 200, body: { access_token: jwt({ sub: "someone-else", exp: 9 }) } }))).status).toBe("invalid");
    expect((await refreshSession(stored, deps({ ok: true, status: 200, body: { access_token: "broken" } }))).status).toBe("invalid");
    expect((await refreshSession(stored, deps({ ok: true, status: 200, body: {} }))).status).toBe("invalid");
  });
});

describe("로그인 돌아오는 주소", () => {
  it("refresh_token도 함께 저장한다", () => {
    const access = jwt({ sub: "u-2", exp: 5, user_metadata: { name: "가" } });
    expect(sessionFromCallbackHash(`#access_token=${access}&refresh_token=rr&expires_in=3600`)).toMatchObject({ userId: "u-2", refreshToken: "rr" });
  });
});
