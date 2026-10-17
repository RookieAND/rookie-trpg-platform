import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { ServerMessage } from "@coc-vtt/shared";
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { WsAdapter } from "@nestjs/platform-ws";
import { AppModule, type AppOptions } from "./app.module";
import { FileRoomRepository } from "./room/infrastructure/file-room.repository";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";


class Client {
  messages: ServerMessage[] = [];
  closed: Promise<number>;
  private ws: WebSocket;
  private waiters: Array<() => void> = [];

  constructor(port: number, query: Record<string, string>) {
    const qs = new URLSearchParams(query).toString();
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/ws?${qs}`);
    this.ws.on("message", (raw) => {
      this.messages.push(JSON.parse(raw.toString()));
      for (const w of this.waiters.splice(0)) w();
    });
    this.closed = new Promise((resolve) => this.ws.on("close", (code) => resolve(code)));
  }

  open() {
    return new Promise<void>((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", reject);
    });
  }

  send(obj: unknown) {
    this.ws.send(JSON.stringify(obj));
  }

  join(lastSeq?: number) {
    this.send({ type: "join", data: lastSeq === undefined ? {} : { lastSeq } });
  }

  cmd(type: string, data: unknown, id?: string) {
    this.send({ id, command: { type, data } });
  }

  async waitFor(pred: (m: ServerMessage) => boolean, timeoutMs = 2000): Promise<ServerMessage> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const hit = this.messages.find(pred);
      if (hit) return hit;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timeout; got ${JSON.stringify(this.messages.map((m) => m.event.type))}`);
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, left);
        this.waiters.push(() => (clearTimeout(t), resolve()));
      });
    }
  }

  types() {
    return this.messages.map((m) => m.event.type);
  }

  close() {
    this.ws.close();
    return this.closed;
  }
}

let app: INestApplication;
let port: number;
let base: string;
let clock = 1_000_000;

async function boot(options: AppOptions = {}) {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register({ joinTimeoutMs: 300, registry: { now: () => clock, saveDebounceMs: 20 }, ...options })],
  }).compile();
  const a = moduleRef.createNestApplication();
  a.useWebSocketAdapter(new WsAdapter(a));
  a.enableShutdownHooks();
  await a.listen(0);
  const p = (a.getHttpServer().address() as { port: number }).port;
  return { app: a, port: p };
}

beforeEach(async () => {
  clock = 1_000_000;
  ({ app, port } = await boot());
  base = `http://127.0.0.1:${port}`;
});
afterEach(async () => {
  await app.close();
});

const api = async (method: string, path: string, user: string, body?: unknown) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-dev-user": user, "x-dev-name": user },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};

/** KP(하늘)가 룸을 만들고 초대 코드를 돌려준다. */
const makeRoom = async (name = "안개 낀 저택") => {
  const r = await api("POST", "/rooms", "kp1", { name });
  return { id: r.json.id as string, invite: r.json.invite.code as string };
};

interface Who {
  user: string;
  name: string;
  role?: string;
}
const KP: Who = { user: "kp1", name: "하늘", role: "kp" };
const SEO: Who = { user: "pl1", name: "윤서하" };
const HAN: Who = { user: "pl2", name: "한도윤" };

const open = async (room: { id: string; invite: string }, who: Who, lastSeq?: number) => {
  const c = new Client(port, { room: room.id, user: who.user, name: who.name, role: who.role ?? "pl", invite: room.invite });
  await c.open();
  c.join(lastSeq);
  return c;
};

const connect = async (room: { id: string; invite: string }, who: Who) => {
  const c = await open(room, who);
  await c.waitFor((m) => m.event.type === "snapshot");
  return c;
};

const isType = (t: string) => (m: ServerMessage) => m.event.type === t;

/** KP가 접속해 세션을 시작한 룸 */
const startedRoom = async () => {
  const room = await makeRoom();
  const kp = await connect(room, KP);
  kp.cmd("session.start", {});
  await kp.waitFor(isType("session.started"));
  return { room, kp };
};

describe("접속 권한", () => {
  it("snapshot을 받고 서로의 접속을 본다", async () => {
    const room = await makeRoom();
    const kp = await connect(room, KP);
    const pl = await connect(room, SEO);
    await kp.waitFor((m) => m.event.type === "presence" && m.event.data.members.length === 2);
    const snap = pl.messages.find(isType("snapshot"));
    expect(snap?.event.type === "snapshot" && snap.event.data.members.map((m) => m.name).sort()).toEqual(["윤서하", "하늘"]);
  });

  it("인증 정보가 없으면 4401로 닫는다", async () => {
    const room = await makeRoom();
    const c = new Client(port, { room: room.id });
    expect(await c.closed).toBe(4401);
  });

  it("없는 룸은 4404", async () => {
    const c = new Client(port, { room: "nope", user: "u", name: "n" });
    expect(await c.closed).toBe(4404);
  });

  it("join을 보내지 않으면 제한 시간 뒤 닫는다", async () => {
    const room = await makeRoom();
    const c = new Client(port, { room: room.id, user: "kp1", name: "하늘", role: "kp" });
    await c.open();
    expect(await c.closed).toBe(4408);
  });

  it("초대 코드가 없거나 틀리면 들어올 수 없다", async () => {
    const room = await makeRoom();
    const none = new Client(port, { room: room.id, user: "pl1", name: "윤서하" });
    expect(await none.closed).toBe(4403);
    const wrong = new Client(port, { room: room.id, user: "pl1", name: "윤서하", invite: "wrong" });
    expect(await wrong.closed).toBe(4403);
  });

  it("주인이 아니면 KP를 요청해도 거절한다", async () => {
    const room = await makeRoom();
    const c = new Client(port, { room: room.id, user: "pl1", name: "윤서하", role: "kp", invite: room.invite });
    expect(await c.closed).toBe(4403);
  });

  it("주인은 어떤 역할을 요청해도 KP다", async () => {
    const room = await makeRoom();
    const c = await connect(room, { ...KP, role: "pl" });
    const snap = c.messages.find(isType("snapshot"));
    expect(snap?.event.type === "snapshot" && snap.event.data.members[0]?.role).toBe("kp");
  });

  it("한 번 PL로 들어온 사용자는 초대 코드가 바뀌어도 다시 들어올 수 있다", async () => {
    const room = await makeRoom();
    const first = await connect(room, SEO);
    await first.close();
    await api("POST", `/rooms/${room.id}/invite`, "kp1", {});
    const again = await connect({ id: room.id, invite: "" }, SEO);
    expect(again.types()).toContain("snapshot");
  });

  it("초대 코드는 만료 시각이 지나면 쓸 수 없다", async () => {
    const room = await makeRoom();
    const r = await api("POST", `/rooms/${room.id}/invite`, "kp1", { expiresInMinutes: 10 });
    const code = r.json.code as string;
    clock += 11 * 60_000;
    const c = new Client(port, { room: room.id, user: "pl1", name: "윤서하", invite: code });
    expect(await c.closed).toBe(4403);
  });

  it("최대 인원을 넘으면 4409", async () => {
    const room = await makeRoom();
    const r = await api("POST", `/rooms/${room.id}/invite`, "kp1", { maxMembers: 2 });
    const code = r.json.code as string;
    await connect({ id: room.id, invite: code }, KP);
    await connect({ id: room.id, invite: code }, SEO);
    const c = new Client(port, { room: room.id, user: "pl2", name: "한도윤", invite: code });
    expect(await c.closed).toBe(4409);
  });
});

describe("실시간 동작", () => {
  it("PL의 토큰 이동이 다른 접속자에게 전달된다", async () => {
    const { room, kp } = await startedRoom();
    const pl = await connect(room, SEO);
    const watcher = await connect(room, HAN);

    kp.cmd("object.add", { kind: "token", name: "윤서하", x: 10, y: 10, ownerId: "pl1" });
    const added = await pl.waitFor(isType("object.added"));
    if (added.event.type !== "object.added") throw new Error();
    const id = added.event.data.id;

    pl.cmd("object.move", { id, x: 300, y: 400, rev: 0 });
    for (const c of [kp, watcher, pl]) {
      const moved = await c.waitFor((m) => m.event.type === "object.updated" && m.event.data.x === 300);
      expect(moved.event).toMatchObject({ data: { id, x: 300, y: 400, rev: 1 } });
    }
  });

  it("KP의 비밀 굴림은 PL에게 결과가 전달되지 않는다", async () => {
    const { room, kp } = await startedRoom();
    const pl = await connect(room, SEO);
    kp.cmd("roll.request", { expr: "1d100", secret: true });
    await kp.waitFor(isType("roll.result"));
    await pl.waitFor(isType("roll.hidden"));
    expect(pl.types()).not.toContain("roll.result");
    expect(JSON.stringify(pl.messages)).not.toContain('"outcome"');
  });

  it("GM 전용 오브젝트는 PL에게 전달되지 않는다", async () => {
    const { room, kp } = await startedRoom();
    const pl = await connect(room, SEO);
    kp.cmd("object.add", { kind: "prop", name: "비밀문", x: 0, y: 0, layer: "gm" });
    await kp.waitFor(isType("object.added"));
    kp.cmd("object.add", { kind: "prop", name: "책상", x: 5, y: 5 });
    await pl.waitFor(isType("object.added"));
    const names = pl.messages.filter(isType("object.added")).map((m) => (m.event.type === "object.added" ? m.event.data.name : ""));
    expect(names).toEqual(["책상"]);
  });

  it("KP가 나가면 PL이 일시정지를 받고, 돌아와 이어하면 진행된다", async () => {
    const { room, kp } = await startedRoom();
    const pl = await connect(room, SEO);
    await kp.close();
    const paused = await pl.waitFor(isType("session.paused"));
    expect(paused.event).toMatchObject({ data: { reason: "kp_disconnected" } });

    pl.cmd("roll.request", { expr: "1d100" }, "r-1");
    await pl.waitFor((m) => m.event.type === "error" && m.event.data.code === "paused");

    const kp2 = await open(room, KP);
    const snap = await kp2.waitFor(isType("snapshot"));
    expect(snap.event.type === "snapshot" && snap.event.data.sessionStatus).toBe("PAUSED");
    kp2.cmd("session.resume", {});
    await pl.waitFor(isType("session.resumed"));
    pl.cmd("roll.request", { expr: "1d100" });
    await pl.waitFor(isType("roll.result"));
  });

  it("세션 시작 전에는 PL의 굴림이 막힌다", async () => {
    const room = await makeRoom();
    await connect(room, KP);
    const pl = await connect(room, SEO);
    pl.cmd("roll.request", { expr: "1d100" });
    await pl.waitFor((m) => m.event.type === "error" && m.event.data.code === "idle");
  });

  it("끊겼다 lastSeq로 다시 접속하면 놓친 이벤트만 받는다", async () => {
    const { room, kp } = await startedRoom();
    const pl = await connect(room, SEO);
    const lastSeq = Math.max(...pl.messages.map((m) => m.seq));
    await pl.close();

    kp.cmd("object.add", { kind: "prop", name: "책상", x: 1, y: 1 });
    await kp.waitFor(isType("object.added"));

    const again = await open(room, SEO, lastSeq);
    await again.waitFor(isType("object.added"));
    expect(again.types()).not.toContain("snapshot");
  });

  it("잘못된 메시지는 bad_message 오류로 돌려준다", async () => {
    const { room } = await startedRoom();
    const pl = await connect(room, SEO);
    pl.send({ id: "x1", command: { type: "object.move", data: { id: "a", x: "oops" } } });
    const err = await pl.waitFor(isType("error"));
    expect(err.event).toMatchObject({ data: { code: "bad_message", requestId: "x1" } });
  });
});

describe("REST", () => {
  it("health", async () => {
    expect((await (await fetch(`${base}/health`)).json()).ok).toBe(true);
  });

  it("로그인 없이는 401", async () => {
    expect((await fetch(`${base}/rooms`)).status).toBe(401);
  });

  it("룸을 만들고 내 목록에서 본다", async () => {
    const room = await makeRoom("달빛 아래의 항구");
    const mine = await api("GET", "/rooms", "kp1");
    expect(mine.json).toEqual([
      expect.objectContaining({ id: room.id, name: "달빛 아래의 항구", role: "kp", sessionStatus: "IDLE", sessionNumber: 0 }),
    ]);
    expect((await api("GET", "/rooms", "pl1")).json).toEqual([]);
  });

  it("초대 코드로 입장 가능 여부를 확인하고, 참가한 뒤에는 내 목록에 보인다", async () => {
    const room = await makeRoom();
    expect((await api("GET", `/rooms/${room.id}`, "pl1")).status).toBe(403);
    const ok = await api("GET", `/rooms/${room.id}?invite=${room.invite}`, "pl1");
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({ name: "안개 낀 저택", role: null });
    expect(ok.json.invite).toBeUndefined(); // 초대 정보는 주인에게만
    await connect(room, SEO);
    const mine = await api("GET", "/rooms", "pl1");
    expect(mine.json).toEqual([expect.objectContaining({ id: room.id, role: "pl" })]);
  });

  it("초대 링크 재생성은 주인만 하고, 이전 코드는 못 쓴다", async () => {
    const room = await makeRoom();
    expect((await api("POST", `/rooms/${room.id}/invite`, "pl1", {})).status).toBe(403);
    const r = await api("POST", `/rooms/${room.id}/invite`, "kp1", { maxMembers: 6 });
    expect(r.status).toBe(200);
    expect(r.json.code).not.toBe(room.invite);
    const old = new Client(port, { room: room.id, user: "pl1", name: "윤서하", invite: room.invite });
    expect(await old.closed).toBe(4403);
  });

  it("잘못된 입력은 400, 없는 룸은 404", async () => {
    expect((await api("POST", "/rooms", "kp1", { name: "" })).status).toBe(400);
    expect((await api("POST", "/rooms/nope/invite", "kp1", {})).status).toBe(404);
  });
});

describe("저장과 복원", () => {
  it("서버를 다시 켜도 룸 상태가 남고, 진행 중이던 세션은 일시정지로 돌아온다", async () => {
    await app.close();
    const dir = mkdtempSync(join(tmpdir(), "coc-vtt-"));
    try {
      ({ app, port } = await boot({ store: new FileRoomRepository(dir) }));
      base = `http://127.0.0.1:${port}`;
      const room = await makeRoom("붉은 달의 의식");
      const kp = await connect(room, KP);
      const pl = await connect(room, SEO);
      kp.cmd("session.start", {});
      await kp.waitFor(isType("session.started"));
      kp.cmd("object.add", { kind: "token", name: "윤서하", x: 70, y: 80, ownerId: "pl1" });
      await pl.waitFor(isType("object.added"));
      pl.cmd("roll.request", { expr: "1d100" });
      await pl.waitFor(isType("roll.result"));

      await app.close(); // 종료 훅이 마지막 상태를 저장한다

      ({ app, port } = await boot({ store: new FileRoomRepository(dir) }));
      base = `http://127.0.0.1:${port}`;
      const mine = await api("GET", "/rooms", "kp1");
      expect(mine.json).toEqual([expect.objectContaining({ id: room.id, name: "붉은 달의 의식", sessionStatus: "PAUSED", sessionNumber: 1 })]);

      const kp2 = await open(room, KP);
      const snap = await kp2.waitFor(isType("snapshot"));
      if (snap.event.type !== "snapshot") throw new Error();
      expect(snap.event.data.objects.map((o) => o.name)).toEqual(["윤서하"]);
      expect(snap.event.data.rolls).toHaveLength(1);
      expect(snap.event.data.sessionStatus).toBe("PAUSED");

      kp2.cmd("session.resume", {});
      await kp2.waitFor(isType("session.resumed"));
      // 복원된 PL은 초대 코드 없이도 다시 들어올 수 있다
      const pl2 = await connect({ id: room.id, invite: "" }, SEO);
      expect(pl2.types()).toContain("snapshot");
    } finally {
      await app.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("바뀐 내용은 잠시 뒤 저장소에 반영된다", async () => {
    await app.close();
    const dir = mkdtempSync(join(tmpdir(), "coc-vtt-"));
    try {
      const store = new FileRoomRepository(dir);
      ({ app, port } = await boot({ store }));
      base = `http://127.0.0.1:${port}`;
      const room = await makeRoom();
      const kp = await connect(room, KP);
      kp.cmd("session.start", {});
      kp.cmd("object.add", { kind: "prop", name: "책상", x: 1, y: 1 });
      await kp.waitFor(isType("object.added"));
      await new Promise((r) => setTimeout(r, 150));
      const stored = await store.load(room.id);
      expect(stored?.data?.objects.map((o) => o.name)).toEqual(["책상"]);
      expect(stored?.data?.status).toBe("ACTIVE");
    } finally {
      await app.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
