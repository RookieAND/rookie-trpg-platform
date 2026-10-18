import "reflect-metadata";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { Test } from "@nestjs/testing";
import { WsAdapter } from "@nestjs/platform-ws";
import type { INestApplication } from "@nestjs/common";
import { Room } from "@coc-vtt/room-core";
import { AppModule, type AppOptions } from "./app.module";
import { MemoryRoomRepository } from "./room/infrastructure/memory-room.repository";
import type { RoomRepository, StoredRoom } from "./room/domain/room.repository";
import { supabaseAuthenticate } from "./identity/infrastructure/supabase-authenticate";
import { createJwtVerifier } from "./identity/infrastructure/jwt-verifier";
import { createHmac } from "node:crypto";
import { createLogger, setLogger, type Level } from "./platform/log";

let app: INestApplication | null = null;
let base = "";
let port = 0;
const logs: Array<Record<string, unknown>> = [];
const prevLogger = setLogger(createLogger({ level: "debug", sink: (line, level: Level) => void logs.push({ ...JSON.parse(line), level }) }));

async function boot(options: AppOptions = {}) {
  const ref = await Test.createTestingModule({ imports: [AppModule.register({ joinTimeoutMs: 2000, registry: { saveDebounceMs: 20 }, hub: { closeWaitMs: 50 }, ...options })] }).compile();
  app = ref.createNestApplication();
  app.useWebSocketAdapter(new WsAdapter(app));
  await app.listen(0);
  port = (app.getHttpServer().address() as { port: number }).port;
  base = `http://127.0.0.1:${port}`;
}
afterEach(async () => {
  vi.restoreAllMocks();
  await app?.close().catch(() => {});
  app = null;
  logs.length = 0;
});

const api = async (method: string, path: string, user: string, body?: unknown) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-dev-user": user, "x-dev-name": user },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await res.text();
  return { status: res.status, text: t, json: t ? JSON.parse(t) : null };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Msg = { event: { type: string; data: { code?: string; message?: string } } };

async function joined(qs: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?${qs}`);
  const received: Msg[] = [];
  ws.on("message", (raw) => received.push(JSON.parse(raw.toString())));
  const closed = new Promise<number>((resolve) => ws.on("close", (code) => resolve(code)));
  await new Promise<void>((resolve) => (ws.once("open", () => resolve()), ws.once("error", () => resolve()), ws.once("close", () => resolve())));
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "join", data: {} }));
  for (let i = 0; i < 100 && !received.some((m) => m.event.type === "snapshot") && ws.readyState !== WebSocket.CLOSED; i++) await sleep(10);
  return { ws, received, closed };
}
const chat = (ws: WebSocket, id: string, text: string) => ws.send(JSON.stringify({ id, command: { type: "chat.send", data: { text } } }));

describe("룸 하나가 예외를 던져도", () => {
  it("그 명령을 보낸 사람에게 오류를 주고, 룸과 다른 룸은 그대로 산다", async () => {
    await boot();
    const a = (await api("POST", "/rooms", "kp1", { name: "A" })).json;
    const b = (await api("POST", "/rooms", "kp2", { name: "B" })).json;
    const ca = await joined(`room=${a.id}&user=kp1&name=kp1&role=kp`);
    const cb = await joined(`room=${b.id}&user=kp2&name=kp2&role=kp`);
    const orig = Room.prototype.handle;
    vi.spyOn(Room.prototype, "handle").mockImplementation(function (this: Room, actor, command) {
      if (command.type === "chat.send" && command.data.text === "boom") throw new Error("고의 예외 token=abc123secret");
      return orig.call(this, actor, command);
    });
    chat(ca.ws, "m1", "boom");
    await sleep(100);
    const err = ca.received.find((m) => m.event.type === "error");
    expect(err?.event.data.code).toBe("internal");
    expect(err?.event.data.message).toMatch(/문제가 생겼어요/);
    expect(ca.ws.readyState).toBe(WebSocket.OPEN); // 연결도 살아 있다
    // 같은 룸의 다음 명령은 정상 처리
    chat(ca.ws, "m2", "안녕하세요");
    await sleep(100);
    expect(ca.received.some((m) => m.event.type === "chat.posted")).toBe(true);
    // 다른 룸은 영향 없음
    chat(cb.ws, "m3", "다른 룸");
    await sleep(100);
    expect(cb.received.some((m) => m.event.type === "chat.posted")).toBe(true);
    expect(cb.received.some((m) => m.event.type === "error")).toBe(false);
    // 로그에는 구조화된 오류가 남고 비밀 값은 가려진다
    const entry = logs.find((l) => l.msg === "메시지 처리 중 예외");
    expect(entry).toMatchObject({ level: "error", roomId: a.id });
    expect(JSON.stringify(entry)).not.toContain("abc123secret");
    ca.ws.close();
    cb.ws.close();
  });

  it("깨진 메시지·알 수 없는 명령도 서버를 흔들지 않는다", async () => {
    await boot();
    const a = (await api("POST", "/rooms", "kp1", { name: "A" })).json;
    const c = await joined(`room=${a.id}&user=kp1&name=kp1&role=kp`);
    c.ws.send("not json");
    c.ws.send(JSON.stringify({ id: "x", command: { type: "nope" } }));
    c.ws.send(Buffer.from([0xff, 0xfe]));
    await sleep(100);
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
    expect((await fetch(`${base}/health`)).status).toBe(200);
    c.ws.close();
  });

  it("룸을 불러오다 예외가 나면 그 연결만 1011로 닫고 서버는 산다", async () => {
    const store = new MemoryRoomRepository();
    await boot({ store });
    const a = (await api("POST", "/rooms", "kp1", { name: "A" })).json;
    // 저장소가 룸 하나를 읽지 못하는 상황(깨진 데이터 등)
    const load = store.load.bind(store);
    vi.spyOn(store, "load").mockImplementation(async (id) => {
      if (id === "badroom") throw new Error("corrupt");
      return load(id);
    });
    const bad = await joined("room=badroom&user=kp1&name=kp1&role=kp");
    expect(await bad.closed).toBe(1011);
    const ok = await joined(`room=${a.id}&user=kp1&name=kp1&role=kp`);
    expect(ok.received.some((m) => m.event.type === "snapshot")).toBe(true);
    ok.ws.close();
  });

  it("컨트롤러의 예상 못 한 예외는 500과 안내 문장만 주고 내부 내용·토큰은 로그에도 응답에도 싣지 않는다", async () => {
    const store = new MemoryRoomRepository();
    await boot({ store });
    const a = (await api("POST", "/rooms", "kp1", { name: "A" })).json;
    // 룸이 이미 메모리에 올라 있으면 저장소를 안 거치므로 새 룸 id로 읽기 실패를 만든다.
    vi.spyOn(store, "load").mockRejectedValue(new Error("db exploded postgres://user:hunter2@db/x"));
    const r = await fetch(`${base}/rooms/otherroom?invite=sekrit&token=eyJhbGciOi.eyJzdWIiOi.abcdefgh`, { headers: { "x-dev-user": "kp1" } });
    const text = await r.text();
    expect(r.status).toBe(500);
    expect(text).toMatch(/문제가 생겼어요/);
    expect(text).not.toMatch(/hunter2|exploded/);
    const entry = logs.find((l) => l.msg === "요청 처리 중 예외");
    expect(entry).toMatchObject({ level: "error", status: 500, path: "/rooms/otherroom" });
    expect(JSON.stringify(logs)).not.toMatch(/hunter2|sekrit|eyJhbGciOi/);
    expect(a.id).toBeTruthy();
  });
});

describe("저장 실패", () => {
  class FlakyStore extends MemoryRoomRepository implements RoomRepository {
    failing = false;
    failOnly: string | null = null;
    override async save(room: StoredRoom) {
      if (this.failing && (!this.failOnly || room.meta.id === this.failOnly)) throw new Error("저장소 장애");
      return super.save(room);
    }
  }

  it("저장이 실패해도 서버와 룸은 산다. /health가 알리고, 복구되면 다시 저장한다", async () => {
    const store = new FlakyStore();
    await boot({ store });
    const a = (await api("POST", "/rooms", "kp1", { name: "A" })).json;
    const c = await joined(`room=${a.id}&user=kp1&name=kp1&role=kp`);
    store.failing = true;
    chat(c.ws, "m1", "저장 안 되는 말");
    await sleep(150);
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
    expect(c.received.some((m) => m.event.type === "chat.posted")).toBe(true);
    const health = await (await fetch(`${base}/health`)).json();
    expect(health.status).toBe("degraded");
    expect(health.saves.consecutiveFailures).toBeGreaterThan(0);
    expect(logs.some((l) => l.msg === "룸 저장 실패" && l.roomId === a.id)).toBe(true);
    // 복구
    store.failing = false;
    chat(c.ws, "m2", "이제 저장돼요");
    await sleep(150);
    const health2 = await (await fetch(`${base}/health`)).json();
    expect(health2.status).toBe("ok");
    const saved = await store.load(a.id);
    expect(JSON.stringify(saved)).toContain("이제 저장돼요");
    c.ws.close();
  });

  it("종료할 때 한 룸의 저장이 실패해도 다른 룸은 저장하고 정상 종료한다", async () => {
    const store = new FlakyStore();
    await boot({ store, registry: { saveDebounceMs: 60_000 } });
    const a = (await api("POST", "/rooms", "kp1", { name: "A" })).json;
    const b = (await api("POST", "/rooms", "kp2", { name: "B" })).json;
    const ca = await joined(`room=${a.id}&user=kp1&name=kp1&role=kp`);
    const cb = await joined(`room=${b.id}&user=kp2&name=kp2&role=kp`);
    chat(ca.ws, "m1", "A의 마지막 말");
    chat(cb.ws, "m2", "B의 마지막 말");
    await sleep(100);
    store.failing = true;
    store.failOnly = a.id;
    await expect(app!.close()).resolves.toBeUndefined();
    expect(JSON.stringify(await store.load(b.id))).toContain("B의 마지막 말");
    expect(logs.some((l) => l.msg === "종료 저장 실패" && l.roomId === a.id)).toBe(true);
    app = null;
  });
});

describe("서버를 내릴 때", () => {
  it("접속자에게 1012(서버 재시작)를 알리고 마지막 상태를 저장한다", async () => {
    const store = new MemoryRoomRepository();
    await boot({ store, registry: { saveDebounceMs: 60_000 } });
    const a = (await api("POST", "/rooms", "kp1", { name: "A" })).json;
    const c = await joined(`room=${a.id}&user=kp1&name=kp1&role=kp`);
    chat(c.ws, "m1", "저장 대기 중인 말");
    await sleep(50);
    expect(JSON.stringify(await store.load(a.id))).not.toContain("저장 대기 중인 말");
    const closing = app!.close();
    expect(await c.closed).toBe(1012);
    await closing;
    app = null;
    expect(JSON.stringify(await store.load(a.id))).toContain("저장 대기 중인 말");
  });
});

describe("/health와 /ready", () => {
  it("DB가 없으면 db: none, 룸·연결 수와 가동 시간을 준다", async () => {
    await boot();
    const a = (await api("POST", "/rooms", "kp1", { name: "A" })).json;
    const c = await joined(`room=${a.id}&user=kp1&name=kp1&role=kp`);
    const h = await (await fetch(`${base}/health`)).json();
    expect(h).toMatchObject({ ok: true, status: "ok", rooms: 1, connections: 1, db: { status: "none" } });
    expect(typeof h.uptimeSec).toBe("number");
    expect(JSON.stringify(h)).not.toMatch(/secret|password|postgres:/i);
    expect((await fetch(`${base}/ready`)).status).toBe(200);
    c.ws.close();
  });

  it("DB에 닿지 않으면 /health는 200(degraded), /ready는 503", async () => {
    let up = true;
    await boot({ db: { query: async () => (up ? { rows: [] } : Promise.reject(new Error("down"))) } });
    expect((await fetch(`${base}/ready`)).status).toBe(200);
    up = false;
    const h = await fetch(`${base}/health`);
    expect(h.status).toBe(200);
    expect(await h.json()).toMatchObject({ status: "degraded", db: { status: "error" } });
    expect((await fetch(`${base}/ready`)).status).toBe(503);
    up = true;
    expect((await fetch(`${base}/ready`)).status).toBe(200);
  });

  it("DB 응답이 오지 않아도 2초 안에 답한다", async () => {
    await boot({ db: { query: () => new Promise(() => {}) } });
    const t0 = Date.now();
    const r = await fetch(`${base}/ready`);
    expect(r.status).toBe(503);
    expect(Date.now() - t0).toBeLessThan(4000);
  });
});

describe("ws 인증은 HTTP와 같은 검증기를 쓴다", () => {
  const SECRET = "ws-secret-ws-secret-ws-secret-ws-secret";
  const tok = (claims: object) => {
    const h = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const p = Buffer.from(JSON.stringify(claims)).toString("base64url");
    return `${h}.${p}.${createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
  };
  const good = () => tok({ sub: "u-kp", exp: Math.floor(Date.now() / 1000) + 600, aud: "authenticated", user_metadata: { full_name: "kp" } });

  it("토큰이 맞으면 HTTP와 ws 모두 들어가고, 틀리거나 개발용 쿼리면 둘 다 거절한다", async () => {
    // 검증이 느려도(JWKS 조회) 먼저 도착한 join 메시지를 잃지 않는다.
    const verify = createJwtVerifier({ hsSecret: SECRET, audience: "authenticated" });
    const slow = supabaseAuthenticate(async (t) => (await sleep(120), verify(t)));
    await boot({ authenticate: slow });
    const bearer = { authorization: `Bearer ${good()}`, "content-type": "application/json" };
    const room = await (await fetch(`${base}/rooms`, { method: "POST", headers: bearer, body: JSON.stringify({ name: "토큰 룸" }) })).json();
    expect(room.id).toBeTruthy();
    expect((await fetch(`${base}/rooms`, { headers: { authorization: "Bearer bad" } })).status).toBe(401);
    expect((await fetch(`${base}/rooms`, { headers: { "x-dev-user": "kp1" } })).status).toBe(401);

    const ok = await joined(`room=${room.id}&token=${encodeURIComponent(good())}&role=kp`);
    expect(ok.received.some((m) => m.event.type === "snapshot")).toBe(true);
    const bad = await joined(`room=${room.id}&token=nope&role=kp`);
    expect(await bad.closed).toBe(4401);
    const dev = await joined(`room=${room.id}&user=kp1&name=kp1&role=kp`);
    expect(await dev.closed).toBe(4401);
    ok.ws.close();
  });

  it("인증 구현이 예외를 던져도 401/4401로 끝나고 서버는 산다", async () => {
    await boot({
      authenticate: () => {
        throw new Error("verifier crashed");
      },
    });
    expect((await fetch(`${base}/rooms`)).status).toBe(401);
    const c = await joined("room=x&token=y");
    expect(await c.closed).toBe(4401);
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });
});

afterEach(() => void 0);
process.on("exit", () => void setLogger(prevLogger));
