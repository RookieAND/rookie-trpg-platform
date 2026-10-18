import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import { WsAdapter } from "@nestjs/platform-ws";
import type { INestApplication } from "@nestjs/common";
import WebSocket from "ws";
import { AppModule } from "../app.module";

const HOOK = "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_-ABC";
let app: INestApplication;
let base: string;
let port: number;
let sent: string[];
let failSend = false;

beforeEach(async () => {
  sent = [];
  failSend = false;
  const ref = await Test.createTestingModule({
    imports: [
      AppModule.register({
        registry: { saveDebounceMs: 20 },
        discord: {
          gateway: { send: async (_u, t) => { if (failSend) throw new Error("boom"); sent.push(t); } },
          notifier: { minIntervalMs: 0 },
        },
      }),
    ],
  }).compile();
  app = ref.createNestApplication();
  app.useWebSocketAdapter(new WsAdapter(app));
  await app.listen(0);
  port = (app.getHttpServer().address() as { port: number }).port;
  base = `http://127.0.0.1:${port}`;
});
afterEach(() => app.close());

const api = async (method: string, path: string, user: string, body?: unknown) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-dev-user": user, "x-dev-name": user },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await res.text();
  return { status: res.status, json: t ? JSON.parse(t) : null };
};
const wait = () => new Promise((r) => setTimeout(r, 80));

describe("디스코드 알림", () => {
  it("주인만 설정하고, 주소는 다시 돌려주지 않는다", async () => {
    const room = (await api("POST", "/rooms", "kp1", { name: "저택" })).json;
    expect((await api("PUT", `/rooms/${room.id}/discord`, "pl1", { webhookUrl: HOOK })).status).toBe(403);
    expect((await api("PUT", `/rooms/${room.id}/discord`, "kp1", { webhookUrl: "http://127.0.0.1/x" })).status).toBe(400);
    expect((await api("PUT", `/rooms/${room.id}/discord`, "kp1", { webhookUrl: HOOK })).status).toBe(200);
    const got = await api("GET", `/rooms/${room.id}`, "kp1");
    expect(got.json.discord.connected).toBe(true);
    expect(JSON.stringify(got.json)).not.toContain("abcdefghij");
    const other = await api("GET", `/rooms/${room.id}?invite=${room.invite.code}`, "pl1");
    expect(other.json.discord).toBeUndefined();
  });

  it("시험 메시지를 보내고, 실패하면 400", async () => {
    const room = (await api("POST", "/rooms", "kp1", { name: "저택" })).json;
    expect((await api("POST", `/rooms/${room.id}/discord/test`, "kp1")).status).toBe(400);
    await api("PUT", `/rooms/${room.id}/discord`, "kp1", { webhookUrl: HOOK });
    expect((await api("POST", `/rooms/${room.id}/discord/test`, "kp1")).status).toBe(200);
    expect(sent).toHaveLength(1);
    failSend = true;
    expect((await api("POST", `/rooms/${room.id}/discord/test`, "kp1")).status).toBe(400);
  });

  it("세션 시작과 공개 굴림은 보내고 비밀 굴림은 보내지 않는다", async () => {
    const room = (await api("POST", "/rooms", "kp1", { name: "저택" })).json;
    await api("PUT", `/rooms/${room.id}/discord`, "kp1", { webhookUrl: HOOK });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${room.id}&user=kp1&name=kp1&role=kp&invite=${room.invite.code}`);
    await new Promise((r) => ws.once("open", r));
    ws.send(JSON.stringify({ type: "join", data: {} }));
    await wait();
    const cmd = (type: string, data: unknown) => ws.send(JSON.stringify({ command: { type, data } }));
    cmd("session.start", {});
    await wait();
    cmd("roll.request", { expr: "1d100" });
    cmd("roll.request", { expr: "1d100", secret: true });
    await wait();
    ws.close();
    expect(sent.some((t) => t.includes("세션"))).toBe(true);
    expect(sent.filter((t) => t.includes("1d100"))).toHaveLength(1);
  });

  it("null로 해제한다", async () => {
    const room = (await api("POST", "/rooms", "kp1", { name: "저택" })).json;
    await api("PUT", `/rooms/${room.id}/discord`, "kp1", { webhookUrl: HOOK });
    await api("PUT", `/rooms/${room.id}/discord`, "kp1", { webhookUrl: null });
    expect((await api("GET", `/rooms/${room.id}`, "kp1")).json.discord.connected).toBe(false);
  });
});

describe("알림 종류만 바꾸기", () => {
  it("주소를 생략하면 저장된 주소를 유지한다", async () => {
    const room = (await api("POST", "/rooms", "kp1", { name: "저택" })).json;
    expect((await api("PUT", `/rooms/${room.id}/discord`, "kp1", { events: { session: false, rolls: true } })).status).toBe(400);
    expect((await api("PUT", `/rooms/${room.id}/discord`, "pl1", { events: { session: false, rolls: true } })).status).toBe(403);
    await api("PUT", `/rooms/${room.id}/discord`, "kp1", { webhookUrl: HOOK });
    const r = await api("PUT", `/rooms/${room.id}/discord`, "kp1", { events: { session: false, rolls: true } });
    expect(r.json).toEqual({ connected: true, events: { session: false, rolls: true } });
    expect((await api("POST", `/rooms/${room.id}/discord/test`, "kp1")).status).toBe(200);
  });
});

describe("룸 삭제", () => {
  it("주인만 지울 수 있고, 지우면 목록과 조회에서 사라진다", async () => {
    const room = (await api("POST", "/rooms", "kp1", { name: "지울 룸" })).json;
    expect((await api("DELETE", `/rooms/${room.id}`, "pl1")).status).toBe(403);
    expect((await api("GET", `/rooms/${room.id}`, "kp1")).status).toBe(200);
    expect((await api("DELETE", `/rooms/${room.id}`, "kp1")).status).toBe(204);
    expect((await api("GET", `/rooms/${room.id}`, "kp1")).status).toBe(404);
    expect((await api("GET", "/rooms", "kp1")).json).toEqual([]);
    expect((await api("DELETE", `/rooms/${room.id}`, "kp1")).status).toBe(404);
  });

  it("붙어 있던 연결은 4404로 끊기고, 늦은 저장이 룸을 되살리지 못한다", async () => {
    const room = (await api("POST", "/rooms", "kp1", { name: "지울 룸" })).json;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${room.id}&user=kp1&name=kp1`);
    await new Promise((r) => ws.once("open", r));
    ws.send(JSON.stringify({ type: "join", data: {} }));
    await wait();
    const closed = new Promise<number>((r) => ws.once("close", (code) => r(code)));
    await api("DELETE", `/rooms/${room.id}`, "kp1");
    expect(await closed).toBe(4404);
    await wait();
    expect((await api("GET", "/rooms", "kp1")).json).toEqual([]);
  });
});
