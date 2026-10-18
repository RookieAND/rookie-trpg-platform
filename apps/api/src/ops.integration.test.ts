import "reflect-metadata";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { Test } from "@nestjs/testing";
import { WsAdapter } from "@nestjs/platform-ws";
import type { INestApplication } from "@nestjs/common";
import { createLogger, setLogger } from "./platform/log";
import { AppModule, type AppOptions } from "./app.module";

let app: INestApplication | null = null;
let base = "";
let port = 0;
const HOOK = "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_-ABC";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);

async function boot(options: AppOptions = {}) {
  const ref = await Test.createTestingModule({ imports: [AppModule.register({ joinTimeoutMs: 2000, registry: { saveDebounceMs: 20 }, ...options })] }).compile();
  app = ref.createNestApplication();
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();
  await app.listen(0);
  port = (app.getHttpServer().address() as { port: number }).port;
  base = `http://127.0.0.1:${port}`;
}
afterEach(async () => {
  vi.restoreAllMocks();
  await app?.close();
  app = null;
});

const api = async (method: string, path: string, user: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-dev-user": user, "x-dev-name": user, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await res.text();
  return { status: res.status, text: t, json: t ? JSON.parse(t) : null };
};

/** 룸에 들어가 join까지 보낸 ws. autoPong=false면 서버 ping에 답하지 않는다. */
async function joined(roomId: string, opts: { autoPong?: boolean } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${roomId}&user=kp1&name=kp&role=kp`, { autoPong: opts.autoPong ?? true });
  const received: Array<{ event: { type: string; data: { code?: string } } }> = [];
  ws.on("message", (raw) => received.push(JSON.parse(raw.toString())));
  const closed = new Promise<number>((resolve) => ws.on("close", (code) => resolve(code)));
  await new Promise<void>((resolve, reject) => (ws.once("open", () => resolve()), ws.once("error", reject)));
  ws.send(JSON.stringify({ type: "join", data: {} }));
  for (let i = 0; i < 100 && !received.some((m) => m.event.type === "snapshot"); i++) await new Promise((r) => setTimeout(r, 10));
  return { ws, received, closed };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("메시지 속도 제한", () => {
  it("한도를 넘기면 rate_limited 오류를 주고, 계속 넘기면 연결을 닫는다", async () => {
    await boot({ hub: { rate: { burst: 10, perSec: 1, maxStrikes: 5, strikeWindowMs: 10_000 } } });
    const room = (await api("POST", "/rooms", "kp1", { name: "저택" })).json;
    const c = await joined(room.id);
    for (let i = 0; i < 40; i++) c.ws.send("{}");
    expect(await c.closed).toBe(1008);
    expect(c.received.some((m) => m.event.type === "error" && m.event.data.code === "rate_limited")).toBe(true);
  });

  it("기본 한도에서는 토큰 드래그 같은 빠른 연속 전송이 막히지 않는다", async () => {
    await boot();
    const room = (await api("POST", "/rooms", "kp1", { name: "저택" })).json;
    const c = await joined(room.id);
    for (let i = 0; i < 100; i++) c.ws.send(JSON.stringify({ id: `m${i}`, command: { type: "object.move", data: { id: "nope", x: i, y: i, rev: 0 } } }));
    await sleep(300);
    expect(c.received.some((m) => m.event.data?.code === "rate_limited")).toBe(false);
    expect(c.ws.readyState).toBe(WebSocket.OPEN);
    c.ws.close();
  });
});

describe("하트비트", () => {
  it("ping에 응답하지 않는 연결은 끊고, 응답하는 연결은 둔다", async () => {
    await boot({ hub: { heartbeatMs: 60 } });
    const room = (await api("POST", "/rooms", "kp1", { name: "저택" })).json;
    const dead = await joined(room.id, { autoPong: false });
    const live = await joined(room.id, { autoPong: true });
    await sleep(400);
    expect(dead.ws.readyState).toBe(WebSocket.CLOSED);
    expect(live.ws.readyState).toBe(WebSocket.OPEN);
    live.ws.close();
  });
});

describe("룸 생성 한도", () => {
  it("계정당 룸 수 상한을 넘으면 403, 지우면 다시 만들 수 있다", async () => {
    await boot({ registry: { saveDebounceMs: 20, maxRoomsPerUser: 2, roomsCreatedPerHour: 100 } });
    const a = await api("POST", "/rooms", "u1", { name: "a" });
    expect((await api("POST", "/rooms", "u1", { name: "b" })).status).toBe(201);
    expect((await api("POST", "/rooms", "u1", { name: "c" })).status).toBe(403);
    expect((await api("POST", "/rooms", "u2", { name: "other" })).status).toBe(201);
    expect((await api("DELETE", `/rooms/${a.json.id}`, "u1")).status).toBe(204);
    expect((await api("POST", "/rooms", "u1", { name: "d" })).status).toBe(201);
  });

  it("시간당 생성 한도를 넘으면 429이고, 시간이 지나면 풀린다", async () => {
    let now = 1_000_000;
    await boot({ registry: { saveDebounceMs: 20, now: () => now, maxRoomsPerUser: 100, roomsCreatedPerHour: 3 } });
    for (let i = 0; i < 3; i++) expect((await api("POST", "/rooms", "u1", { name: `r${i}` })).status).toBe(201);
    expect((await api("POST", "/rooms", "u1", { name: "x" })).status).toBe(429);
    now += 3_600_001;
    expect((await api("POST", "/rooms", "u1", { name: "y" })).status).toBe(201);
  });

  it("동시에 보낸 생성 요청도 상한을 넘지 못한다", async () => {
    await boot({ registry: { saveDebounceMs: 20, maxRoomsPerUser: 3, roomsCreatedPerHour: 100 } });
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => api("POST", "/rooms", "u1", { name: `r${i}` })));
    expect(rs.filter((r) => r.status === 201).length).toBeLessThanOrEqual(3);
  });
});

describe("업로드 IP 한도", () => {
  const upload = (user: string, headers: Record<string, string> = {}) =>
    fetch(`${base}/images`, { method: "POST", headers: { "x-dev-user": user, ...headers }, body: new Uint8Array(PNG) });

  it("계정을 바꿔도 같은 IP면 전역 한도에 걸린다", async () => {
    await boot({ imageOptions: { maxUploads: 100, maxUploadsPerIp: 3 } });
    for (let i = 0; i < 3; i++) expect((await upload(`fake${i}`)).status).toBe(201);
    expect((await upload("fake99")).status).toBe(429);
  });

  it("프록시를 믿지 않으면 X-Forwarded-For를 바꿔도 우회할 수 없다", async () => {
    await boot({ imageOptions: { maxUploads: 100, maxUploadsPerIp: 2 } });
    expect((await upload("a", { "x-forwarded-for": "1.1.1.1" })).status).toBe(201);
    expect((await upload("b", { "x-forwarded-for": "2.2.2.2" })).status).toBe(201);
    expect((await upload("c", { "x-forwarded-for": "3.3.3.3" })).status).toBe(429);
  });

  it("TRUST_PROXY일 때는 프록시가 붙인 마지막 주소로 센다", async () => {
    await boot({ trustProxyHops: 1, imageOptions: { maxUploads: 100, maxUploadsPerIp: 2 } });
    // 왼쪽(클라이언트가 적는 값)을 바꿔도 같은 사용자로 센다.
    expect((await upload("a", { "x-forwarded-for": "evil1, 9.9.9.9" })).status).toBe(201);
    expect((await upload("b", { "x-forwarded-for": "evil2, 9.9.9.9" })).status).toBe(201);
    expect((await upload("c", { "x-forwarded-for": "evil3, 9.9.9.9" })).status).toBe(429);
    expect((await upload("d", { "x-forwarded-for": "evil3, 8.8.8.8" })).status).toBe(201);
  });
});

describe("룸을 지우면 참조하던 이미지·오디오도 지운다", () => {
  it("룸 데이터가 참조하는 파일만 함께 사라지고, 다른 파일은 남는다", async () => {
    await boot();
    const room = (await api("POST", "/rooms", "kp1", { name: "저택" })).json;
    const up = async (path: string, body: Buffer) =>
      ((await (await fetch(`${base}${path}`, { method: "POST", headers: { "x-dev-user": "kp1" }, body: new Uint8Array(body) })).json()) as { id: string }).id;
    const song = await up("/audio", Buffer.concat([Buffer.from("ID3"), Buffer.alloc(32, 3)]));
    const other = await up("/audio", Buffer.concat([Buffer.from("ID3"), Buffer.alloc(32, 4)]));

    const c = await joined(room.id);
    c.ws.send(JSON.stringify({ id: "a1", command: { type: "audio.track.add", data: { label: "bgm", kind: "bgm", assetId: song, volume: 80 } } }));
    for (let i = 0; i < 100 && !c.received.some((m) => JSON.stringify(m).includes(song)); i++) await sleep(10);
    expect(JSON.stringify(c.received.slice(1))).toContain(song);
    c.ws.close();

    expect((await fetch(`${base}/audio/${song}`)).status).toBe(200);
    expect((await api("DELETE", `/rooms/${room.id}`, "kp1")).status).toBe(204);
    expect((await fetch(`${base}/audio/${song}`)).status).toBe(404);
    expect((await fetch(`${base}/audio/${other}`)).status).toBe(200);
  });
});

describe("/health", () => {
  it("버전과 가동 시간만 알려주고 비밀은 싣지 않는다", async () => {
    await boot();
    const r = await api("GET", "/health", "x");
    expect(r.json.ok).toBe(true);
    expect(typeof r.json.version).toBe("string");
    expect(r.json.uptimeSec).toBeGreaterThanOrEqual(0);
    expect(Object.keys(r.json).sort()).toEqual(["connections", "db", "ok", "rooms", "saves", "status", "uptimeSec", "version"]);
  });
});

describe("디스코드 웹훅 주소 비노출", () => {
  it("전송 오류에 주소가 섞여도 응답과 로그에 나가지 않는다", async () => {
    const lines: string[] = [];
    const prev = setLogger(createLogger({ sink: (l) => void lines.push(l) }));
    await boot({
      discord: {
        gateway: { send: async (url) => { throw new Error(`요청 실패: ${url}`); } },
        notifier: { minIntervalMs: 0 },
      },
    });
    const room = (await api("POST", "/rooms", "kp1", { name: "저택" })).json;
    expect((await api("PUT", `/rooms/${room.id}/discord`, "kp1", { webhookUrl: HOOK })).status).toBe(200);
    const t = await api("POST", `/rooms/${room.id}/discord/test`, "kp1");
    expect(t.status).toBe(400);
    expect(t.text).not.toContain("abcdefghij");
    // 알림 전송 실패 로그 경로
    const c = await joined(room.id);
    c.ws.send(JSON.stringify({ id: "s", command: { type: "session.start", data: {} } }));
    await sleep(300);
    c.ws.close();
    setLogger(prev);
    const logged = lines.join("\n");
    expect(logged).not.toContain("abcdefghij");
    expect(logged).toContain("[웹훅 주소]");
  });
});
