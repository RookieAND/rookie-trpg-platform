import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { WsAdapter } from "@nestjs/platform-ws";
import { AppModule, type AppOptions } from "./app.module";
import { RoomRegistry } from "./room/application/room-registry";
import { devAuthenticate } from "./identity/infrastructure/dev-authenticate";
import type { Authenticate } from "./identity/domain/identity";

let app: INestApplication | null = null;
let base = "";
let port = 0;
let clock = 1_000_000;

async function boot(options: AppOptions = {}) {
  clock = 1_000_000;
  const ref = await Test.createTestingModule({
    imports: [AppModule.register({ joinTimeoutMs: 300, kpAwayGraceMs: 150, registry: { now: () => clock, saveDebounceMs: 20 }, ...options })],
  }).compile();
  app = ref.createNestApplication({ bodyParser: true });
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();
  await app.listen(0);
  port = (app.getHttpServer().address() as { port: number }).port;
  base = `http://127.0.0.1:${port}`;
  return ref;
}
afterEach(async () => {
  await app?.close();
  app = null;
});

const call = async (method: string, path: string, user: string, body?: unknown, raw?: string) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-dev-user": user, "x-dev-name": user },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not json */
  }
  return { status: res.status, json, text };
};
const makeRoom = async (user = "kp1") => {
  const r = await call("POST", "/rooms", user, { name: "보안 시험" });
  return { id: r.json.id as string, invite: r.json.invite.code as string };
};

/** 연결해서 첫 응답이나 닫힘 코드를 돌려준다. */
const wsOpen = (query: Record<string, string>, onOpen?: (ws: WebSocket) => void) =>
  new Promise<{ ws: WebSocket; closed: Promise<number>; messages: any[] }>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?${new URLSearchParams(query)}`);
    const messages: any[] = [];
    ws.on("message", (m) => messages.push(JSON.parse(m.toString())));
    const closed = new Promise<number>((r) => ws.on("close", (c) => r(c)));
    ws.on("open", () => {
      onOpen?.(ws);
      resolve({ ws, closed, messages });
    });
    ws.on("error", () => resolve({ ws, closed, messages }));
  });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (pred: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("timeout");
    await sleep(10);
  }
};

describe("S-02 가져오기 DoS 방어", () => {
  it("12MB를 넘는 본문은 413으로 바로 거절하고, 그 사이에도 /health는 빠르게 답한다", async () => {
    await boot();
    const room = await makeRoom();
    const big = JSON.stringify({ format: "x", pad: "a".repeat(13 * 1024 * 1024) });
    const t0 = Date.now();
    const [res, health] = await Promise.all([
      call("POST", `/rooms/${room.id}/scenario?dryRun=1`, "kp1", undefined, big),
      (async () => {
        await sleep(5);
        const h0 = Date.now();
        const r = await fetch(`${base}/health`);
        return { status: r.status, ms: Date.now() - h0 };
      })(),
    ]);
    expect(res.status).toBe(413);
    expect(res.text).not.toMatch(/at .*\.(ts|js):\d+/);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(health.status).toBe(200);
    expect(health.ms).toBeLessThan(500);
  });

  it("너무 깊게 중첩된 JSON과 토큰이 너무 많은 JSON은 파싱 전에 거절한다", async () => {
    await boot();
    const room = await makeRoom();
    const deep = "[".repeat(5000) + "]".repeat(5000);
    const r1 = await call("POST", `/rooms/${room.id}/scenario?dryRun=1`, "kp1", undefined, deep);
    expect([400, 413, 422]).toContain(r1.status);
    const many = "[" + "1,".repeat(400_000) + "1]";
    const r2 = await call("POST", `/rooms/${room.id}/scenario?dryRun=1`, "kp1", undefined, many);
    expect([400, 413, 422]).toContain(r2.status);
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it("dryRun도 시간당 횟수에 들어간다", async () => {
    await boot();
    const room = await makeRoom();
    let limited = 0;
    for (let i = 0; i < 45; i++) {
      const r = await call("POST", `/rooms/${room.id}/scenario?dryRun=1`, "kp1", undefined, "{}");
      if (r.status === 429) limited++;
    }
    expect(limited).toBeGreaterThan(0);
  });
});

describe("S-01 프로토타입 오염", () => {
  it("스킬 이름 __proto__는 웹소켓으로도 거절하고 Object.prototype은 그대로다", async () => {
    await boot();
    const room = await makeRoom();
    const kp = await wsOpen({ room: room.id, user: "kp1", name: "kp1", role: "kp", invite: room.invite }, (ws) => ws.send(JSON.stringify({ type: "join", data: {} })));
    await waitFor(() => kp.messages.some((m) => m.event.type === "snapshot"));
    kp.ws.send(JSON.stringify({ id: "p1", command: { type: "sheet.patch", data: { characterId: "x", ops: [{ path: "skills.__proto__.polluted", value: 99 }] } } }));
    kp.ws.send(JSON.stringify({ id: "p2", command: { type: "skill.add", data: { name: "__proto__", value: 50 } } }));
    await sleep(200);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(Object.prototype)).toEqual([]);
    kp.ws.close();
  });
});

describe("S-13 오류 응답", () => {
  it("깨진 JSON은 400 JSON이고 스택이 없다", async () => {
    await boot();
    const r = await call("POST", "/rooms", "kp1", undefined, "{not json");
    expect(r.status).toBe(400);
    expect(r.json).toBeTruthy();
    expect(r.text).not.toMatch(/node_modules|at .*:\d+:\d+/);
  });
  it("100KB를 넘는 일반 본문은 413 JSON이다", async () => {
    await boot();
    const r = await call("POST", "/rooms", "kp1", undefined, JSON.stringify({ name: "a".repeat(300_000) }));
    expect(r.status).toBe(413);
    expect(r.json).toBeTruthy();
  });
});

describe("S-14 HTTP 속도 제한", () => {
  it("한도를 넘으면 429 + retry-after, /health는 제외된다", async () => {
    await boot({ httpRate: { enabled: true, ipPerMin: 20, userPerMin: 10 } });
    let last = 0;
    let retry: string | null = null;
    for (let i = 0; i < 40; i++) {
      const res = await fetch(`${base}/rooms`, { headers: { "x-dev-user": "u1", "x-dev-name": "u1" } });
      last = res.status;
      if (res.status === 429) {
        retry = res.headers.get("retry-after");
        break;
      }
    }
    expect(last).toBe(429);
    expect(Number(retry)).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) expect((await fetch(`${base}/health`)).status).toBe(200);
  });
});

describe("S-03 웹소켓 연결 수 제한", () => {
  it("한 사용자가 상한을 넘기면 가장 오래된 연결이 4412로 닫힌다", async () => {
    await boot({ wsLimits: { perUser: 2, perIp: 100, perRoom: 100 } });
    const room = await makeRoom();
    const q = { room: room.id, user: "kp1", name: "kp1", role: "kp", invite: room.invite };
    const a = await wsOpen(q, (ws) => ws.send(JSON.stringify({ type: "join", data: {} })));
    const b = await wsOpen(q, (ws) => ws.send(JSON.stringify({ type: "join", data: {} })));
    await waitFor(() => a.messages.length > 0 && b.messages.length > 0);
    const c = await wsOpen(q, (ws) => ws.send(JSON.stringify({ type: "join", data: {} })));
    expect(await a.closed).toBe(4412);
    await waitFor(() => c.messages.length > 0);
    c.ws.close();
    b.ws.close();
  });

  it("같은 IP에서 상한을 넘으면 새 연결이 4413으로 닫힌다", async () => {
    await boot({ wsLimits: { perUser: 50, perIp: 3, perRoom: 100 } });
    const room = await makeRoom();
    const open: Awaited<ReturnType<typeof wsOpen>>[] = [];
    for (let i = 0; i < 3; i++) open.push(await wsOpen({ room: room.id, user: `u${i}`, name: `u${i}`, invite: room.invite }, (ws) => ws.send(JSON.stringify({ type: "join", data: {} }))));
    const extra = await wsOpen({ room: room.id, user: "u9", name: "u9", invite: room.invite });
    expect(await extra.closed).toBe(4413);
    for (const o of open) o.ws.close();
  });
});

describe("S-11 토큰 만료와 첫 메시지 로그인", () => {
  const auth: Authenticate = (req, url) => {
    const h = req.headers.authorization;
    const m = typeof h === "string" ? /^Bearer t:([a-z0-9]+):(\d+)$/.exec(h) : null;
    if (m) return { userId: m[1]!, name: m[1]!, requestedRole: "pl", expiresAt: Number(m[2]) };
    return devAuthenticate(req, url);
  };

  it("주소에 토큰 없이 연결해 첫 메시지(auth)로 로그인한다. 잘못된 토큰은 4401", async () => {
    await boot({ authenticate: auth, hub: { heartbeatMs: 20 } });
    const room = await makeRoom("owner");
    const good = await wsOpen({ room: room.id, invite: room.invite }, (ws) => {
      ws.send(JSON.stringify({ type: "auth", data: { token: `t:ann:${Date.now() + 60_000}` } }));
      ws.send(JSON.stringify({ type: "join", data: {} }));
    });
    await waitFor(() => good.messages.some((m) => m.event.type === "snapshot"));
    good.ws.close();
    const bad = await wsOpen({ room: room.id, invite: room.invite }, (ws) => ws.send(JSON.stringify({ type: "auth", data: { token: "nope" } })));
    expect(await bad.closed).toBe(4401);
  });

  it("토큰이 만료되면 하트비트에서 4401로 닫고, 새 토큰을 보내면 계속 열려 있다", async () => {
    await boot({ authenticate: auth, hub: { heartbeatMs: 20 } });
    const room = await makeRoom("owner");
    const short = await wsOpen({ room: room.id, invite: room.invite }, (ws) => {
      ws.send(JSON.stringify({ type: "auth", data: { token: `t:ann:${Date.now() + 150}` } }));
      ws.send(JSON.stringify({ type: "join", data: {} }));
    });
    await waitFor(() => short.messages.some((m) => m.event.type === "snapshot"));
    expect(await short.closed).toBe(4401);

    const kept = await wsOpen({ room: room.id, invite: room.invite }, (ws) => {
      ws.send(JSON.stringify({ type: "auth", data: { token: `t:bob:${Date.now() + 150}` } }));
      ws.send(JSON.stringify({ type: "join", data: {} }));
    });
    await waitFor(() => kept.messages.some((m) => m.event.type === "snapshot"));
    kept.ws.send(JSON.stringify({ type: "auth", data: { token: `t:bob:${Date.now() + 60_000}` } }));
    await sleep(400);
    expect(kept.ws.readyState).toBe(WebSocket.OPEN);
    kept.ws.close();
  });
});

describe("S-08 기록 비우기", () => {
  it("주인만 비울 수 있고, 범위가 틀리면 400이며, 저장된 데이터에서도 사라진다", async () => {
    await boot();
    const room = await makeRoom();
    const kp = await wsOpen({ room: room.id, user: "kp1", name: "kp1", role: "kp", invite: room.invite }, (ws) => ws.send(JSON.stringify({ type: "join", data: {} })));
    await waitFor(() => kp.messages.some((m) => m.event.type === "snapshot"));
    kp.ws.send(JSON.stringify({ id: "c1", command: { type: "chat.send", data: { text: "비밀 얘기" } } }));
    await waitFor(() => kp.messages.some((m) => m.event.type === "chat.posted"));
    expect((await call("DELETE", `/rooms/${room.id}/history?scope=chat`, "pl9")).status).toBe(403);
    expect((await call("DELETE", `/rooms/${room.id}/history?scope=zzz`, "kp1")).status).toBe(400);
    const ok = await call("DELETE", `/rooms/${room.id}/history?scope=chat`, "kp1");
    expect(ok.status).toBe(200);
    await waitFor(() => kp.messages.some((m) => m.event.type === "history.purged"));
    kp.ws.close();
  });
});

describe("S-16 쉬는 룸 메모리 정리", () => {
  it("접속자가 없는 룸은 저장한 뒤 내리고, 다시 들어오면 불러온다", async () => {
    let t = 1_000_000;
    const ref = await boot({ roomIdleMinutes: 1, registry: { now: () => t, saveDebounceMs: 5 } });
    const room = await makeRoom();
    const registry = ref.get(RoomRegistry);
    expect(await registry.get(room.id)).toBeTruthy();
    // 처음 부르면 쉬기 시작한 시각만 적고, 시간이 지난 뒤 부르면 내린다.
    const hub = (await import("./room/interface/ws/room.hub")).RoomHub;
    const h = ref.get(hub);
    await h.evictIdleRooms();
    t += 2 * 60_000;
    expect(await h.evictIdleRooms()).toContain(room.id);
    const again = await call("GET", `/rooms/${room.id}`, "kp1");
    expect(again.status).toBe(200);
    expect(again.json.name).toBe("보안 시험");
  });
});

describe("S-12 디스코드 시험 전송", () => {
  it("분당 3번을 넘으면 429", async () => {
    await boot({ discord: { gateway: { send: async () => {} }, notifier: { minIntervalMs: 0 } } });
    const room = await makeRoom();
    expect((await call("PUT", `/rooms/${room.id}/discord`, "kp1", { webhookUrl: "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_-ABC" })).status).toBe(200);
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await call("POST", `/rooms/${room.id}/discord/test`, "kp1")).status);
    expect(codes).toContain(429);
    const got = await call("GET", `/rooms/${room.id}/discord`, "kp1");
    expect(JSON.stringify(got.json)).not.toContain("abcdefghijklmnopqrstuvwxyz");
  });
});
