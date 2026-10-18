import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { ServerMessage } from "@coc-vtt/shared";
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { WsAdapter } from "@nestjs/platform-ws";
import { AppModule, type AppOptions } from "./app.module";
import { FileRoomRepository } from "./room/infrastructure/file-room.repository";
import { RoomRegistry } from "./room/application/room-registry";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
    imports: [AppModule.register({ joinTimeoutMs: 300, kpAwayGraceMs: 150, registry: { now: () => clock, saveDebounceMs: 20 }, ...options })],
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

/** GM(하늘)가 룸을 만들고 초대 코드를 돌려준다. */
const makeRoom = async (name = "안개 낀 저택") => {
  const r = await api("POST", "/rooms", "kp1", { name });
  return { id: r.json.id as string, invite: r.json.invite.code as string };
};

interface Who {
  user: string;
  name: string;
  role?: string;
}
const GM: Who = { user: "kp1", name: "하늘", role: "kp" };
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

/** GM이 접속해 세션을 시작한 룸 */
const startedRoom = async () => {
  const room = await makeRoom();
  const kp = await connect(room, GM);
  kp.cmd("session.start", {});
  await kp.waitFor(isType("session.started"));
  return { room, kp };
};

describe("접속 권한", () => {
  it("snapshot을 받고 서로의 접속을 본다", async () => {
    const room = await makeRoom();
    const kp = await connect(room, GM);
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

  it("주인이 아니면 GM을 요청해도 거절한다", async () => {
    const room = await makeRoom();
    const c = new Client(port, { room: room.id, user: "pl1", name: "윤서하", role: "kp", invite: room.invite });
    expect(await c.closed).toBe(4403);
  });

  it("주인은 어떤 역할을 요청해도 GM이다", async () => {
    const room = await makeRoom();
    const c = await connect(room, { ...GM, role: "pl" });
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
    await connect({ id: room.id, invite: code }, GM);
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

  it("GM의 비밀 굴림은 PL에게 결과가 전달되지 않는다", async () => {
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

  it("GM이 나가도 유예 동안은 정지하지 않고, 유예가 지나면 PL이 자동 정지를 받는다", async () => {
    const { room, kp } = await startedRoom();
    const pl = await connect(room, SEO);
    await kp.close();
    const away = await pl.waitFor(isType("kp.away"));
    expect(away.event.type === "kp.away" && typeof away.event.data.since).toBe("number");
    // 유예 중에는 PL이 계속 굴릴 수 있다
    pl.cmd("roll.request", { expr: "1d100" });
    await pl.waitFor(isType("roll.result"));
    expect(pl.types()).not.toContain("session.paused");

    const paused = await pl.waitFor(isType("session.paused"));
    expect(paused.event).toMatchObject({ data: { reason: "kp_disconnected" } });
    pl.cmd("roll.request", { expr: "1d100" }, "r-1");
    await pl.waitFor((m) => m.event.type === "error" && m.event.data.code === "paused");
  });

  it("유예 안에 GM이 돌아오면 정지 없이 계속된다", async () => {
    const { room, kp } = await startedRoom();
    const pl = await connect(room, SEO);
    await kp.close();
    await pl.waitFor(isType("kp.away"));
    const kp2 = await open(room, GM);
    await kp2.waitFor(isType("snapshot"));
    await pl.waitFor(isType("kp.back"));
    await new Promise((r) => setTimeout(r, 350)); // 유예(150ms)가 지나도
    expect(pl.types()).not.toContain("session.paused");
    pl.cmd("roll.request", { expr: "1d100" });
    await pl.waitFor(isType("roll.result"));
  });

  it("자동 정지 뒤 GM이 돌아오면 자동 재개하고, GM이 직접 멈춘 세션은 그대로 둔다", async () => {
    const { room, kp } = await startedRoom();
    const pl = await connect(room, SEO);
    await kp.close();
    await pl.waitFor(isType("session.paused"));
    const kp2 = await open(room, GM);
    await pl.waitFor(isType("session.resumed"));
    const snap = await kp2.waitFor(isType("snapshot"));
    expect(snap.event.type === "snapshot" && snap.event.data.sessionStatus).toBe("ACTIVE");
    pl.cmd("roll.request", { expr: "1d100" });
    await pl.waitFor(isType("roll.result"));

    // GM이 직접 멈춘 경우
    kp2.cmd("session.pause", {});
    await pl.waitFor((m) => m.event.type === "session.paused" && m.event.data.reason === "kp_request");
    await kp2.close();
    await new Promise((r) => setTimeout(r, 350));
    const kp3 = await open(room, GM);
    const snap3 = await kp3.waitFor(isType("snapshot"));
    expect(snap3.event.type === "snapshot" && snap3.event.data).toMatchObject({ sessionStatus: "PAUSED", pauseReason: "kp_request" });
  });

  it("정지 중에도 GM은 준비성 편집을 할 수 있고, 굴림은 막힌다", async () => {
    const { room, kp } = await startedRoom();
    kp.cmd("session.pause", {});
    await kp.waitFor(isType("session.paused"));
    kp.cmd("object.add", { kind: "prop", name: "책상", x: 1, y: 1 });
    await kp.waitFor(isType("object.added"));
    kp.cmd("roll.request", { expr: "1d100", secret: true }, "k-1");
    await kp.waitFor((m) => m.event.type === "error" && m.event.data.code === "paused");
    expect(room.id).toBeTruthy();
  });

  it("GM 새로고침(연결을 닫고 곧바로 다시 붙임)에는 정지 이벤트가 없다", async () => {
    const { room, kp } = await startedRoom();
    const pl = await connect(room, SEO);
    await kp.close();
    const kp2 = await open(room, GM);
    await kp2.waitFor(isType("snapshot"));
    await new Promise((r) => setTimeout(r, 350));
    expect(pl.types()).not.toContain("session.paused");
    expect(pl.types()).not.toContain("session.resumed");
  });

  it("세션 시작 전에는 PL의 굴림이 막힌다", async () => {
    const room = await makeRoom();
    await connect(room, GM);
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
  it("서버를 다시 켜도 룸 상태가 남고, 진행 중이던 세션은 자동 정지로 돌아와 GM이 들어오면 재개된다", async () => {
    await app.close();
    const dir = mkdtempSync(join(tmpdir(), "coc-vtt-"));
    try {
      ({ app, port } = await boot({ store: new FileRoomRepository(dir) }));
      base = `http://127.0.0.1:${port}`;
      const room = await makeRoom("붉은 달의 의식");
      const kp = await connect(room, GM);
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

      // GM보다 먼저 들어온 PL은 자동 정지 상태를 본다
      const pl1 = await connect({ id: room.id, invite: "" }, SEO);
      const plSnap = pl1.messages.find(isType("snapshot"));
      expect(plSnap?.event.type === "snapshot" && plSnap.event.data).toMatchObject({ sessionStatus: "PAUSED", pauseReason: "kp_disconnected" });

      const kp2 = await open(room, GM);
      const snap = await kp2.waitFor(isType("snapshot"));
      if (snap.event.type !== "snapshot") throw new Error();
      expect(snap.event.data.objects.map((o) => o.name)).toEqual(["윤서하"]);
      expect(snap.event.data.rolls).toHaveLength(1);
      // GM이 들어오면 별도 이어하기 없이 자동 재개된다
      expect(snap.event.data.sessionStatus).toBe("ACTIVE");
      await pl1.waitFor(isType("session.resumed"));
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
      const kp = await connect(room, GM);
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

const SPEC: Who = { user: "sp1", name: "구경꾼", role: "spectator" };
const bytes = (m: unknown) => Buffer.byteLength(JSON.stringify(m));
const chatOf = (c: Client) => c.messages.flatMap((m) => (m.event.type === "chat.posted" ? [m.event.data] : []));

describe("대화", () => {
  it("PL의 말이 GM과 다른 PL, 관전자에게 전달된다", async () => {
    const { room, kp } = await startedRoom();
    const pl = await connect(room, SEO);
    const han = await connect(room, HAN);
    const spec = await connect(room, SPEC);
    pl.cmd("chat.send", { text: "  안녕하세요 " });
    for (const c of [kp, han, spec, pl]) {
      const m = await c.waitFor(isType("chat.posted"));
      expect(m.event.type === "chat.posted" && m.event.data).toMatchObject({ kind: "say", name: "윤서하", text: "안녕하세요" });
    }
  });

  it("귓속말은 받는 사람에게만 가고, 다른 PL·관전자는 프레임으로도 새 접속의 기록으로도 받지 못한다", async () => {
    const { room, kp } = await startedRoom();
    const pl = await connect(room, SEO);
    const han = await connect(room, HAN);
    const spec = await connect(room, SPEC);
    kp.cmd("chat.send", { text: "/w 윤서하 문 뒤에 누가 있어요" });
    await pl.waitFor(isType("chat.posted"));
    kp.cmd("chat.send", { text: "모두에게 하는 말이에요" });
    for (const c of [pl, han, spec]) await c.waitFor((m) => m.event.type === "chat.posted" && m.event.data.kind === "say");
    for (const c of [han, spec]) {
      expect(JSON.stringify(c.messages)).not.toContain("문 뒤에");
      expect(chatOf(c).map((m) => m.kind)).toEqual(["say"]);
    }
    expect(chatOf(pl).map((m) => m.kind)).toEqual(["whisper", "say"]);
    // 나중에 들어오는 사람의 기록과 다시 붙는 연결에도 새지 않는다
    const han2 = await connect(room, HAN);
    await han2.waitFor((m) => m.event.type === "chat.history" && m.event.data.last);
    expect(JSON.stringify(han2.messages)).not.toContain("문 뒤에");
    const pl2 = await connect(room, SEO);
    await pl2.waitFor((m) => m.event.type === "chat.history" && m.event.data.last);
    expect(JSON.stringify(pl2.messages)).toContain("문 뒤에");
  });

  it("PL끼리의 귓속말은 기본으로 막혀 있고, 켜면 GM도 받지 못한다", async () => {
    const { room, kp } = await startedRoom();
    const pl = await connect(room, SEO);
    const han = await connect(room, HAN);
    pl.cmd("chat.send", { text: "/w 한도윤 몰래 말해요" }, "w1");
    const err = await pl.waitFor((m) => m.event.type === "error");
    expect(err.event.type === "error" && err.event.data.code).toBe("forbidden");
    kp.cmd("settings.chat", { plWhisper: true });
    await han.waitFor((m) => m.event.type === "settings.chat" && m.event.data.plWhisper);
    pl.cmd("chat.send", { text: "/w 한도윤 몰래 말해요" });
    await han.waitFor(isType("chat.posted"));
    await new Promise((r) => setTimeout(r, 100));
    expect(JSON.stringify(kp.messages)).not.toContain("몰래 말해요");
  });

  it("속도 제한: 한 사람이 1초에 3번을 넘기면 rate_limited", async () => {
    const { room } = await startedRoom();
    const pl = await connect(room, SEO);
    for (let i = 0; i < 6; i++) pl.cmd("chat.send", { text: `연타 ${i}` }, `c${i}`);
    const err = await pl.waitFor((m) => m.event.type === "error" && m.event.data.code === "rate_limited");
    expect(err.event.type === "error" && err.event.data.requestId).toBeDefined();
    await new Promise((r) => setTimeout(r, 100));
    expect(chatOf(pl).length).toBeLessThanOrEqual(3);
  });

  it("/r은 대화와 굴림 기록에 함께 남고, /hr은 다른 PL에게 결과가 가지 않는다", async () => {
    const { room, kp } = await startedRoom();
    const pl = await connect(room, SEO);
    const han = await connect(room, HAN);
    pl.cmd("chat.send", { text: "/r 1d100" });
    await han.waitFor(isType("roll.result"));
    const chat = await han.waitFor(isType("chat.posted"));
    expect(chat.event.type === "chat.posted" && chat.event.data).toMatchObject({ kind: "roll", roll: { expr: "1d100" } });
    pl.cmd("chat.send", { text: "/hr 3d6+31" });
    await kp.waitFor((m) => m.event.type === "chat.posted" && m.event.data.kind === "secret");
    await new Promise((r) => setTimeout(r, 100));
    expect(JSON.stringify(han.messages)).not.toContain("3d6+31");
  });

  it("접속하면 최근 100개의 대화가 16KB 안쪽의 조각으로 나뉘어 오고, 이전 대화는 HTTP로 받는다", async () => {
    await app.close();
    ({ app, port } = await boot({ registry: { now: () => clock, saveDebounceMs: 20, room: { now: () => clock } } }));
    base = `http://127.0.0.1:${port}`;
    const { room, kp } = await startedRoom();
    const pl = await connect(room, SEO);
    const reg = app.get(RoomRegistry);
    const entry = (await reg.get(room.id))!;
    const actor = { userId: "pl1", name: "윤서하", role: "pl" as const };
    for (let i = 0; i < 130; i++) {
      clock += 400;
      const r = entry.room.handle(actor, { type: "chat.send", data: { text: `${String(i).padStart(3, "0")} ${"가".repeat(480)}` } });
      if (!r.ok) throw new Error(r.message);
    }
    const han = await connect(room, HAN);
    await han.waitFor((m) => m.event.type === "chat.history" && m.event.data.last);
    const frames = han.messages.filter(isType("chat.history"));
    expect(frames.length).toBeGreaterThan(5);
    for (const f of frames) expect(bytes(f)).toBeLessThan(16 * 1024);
    const got = frames.flatMap((f) => (f.event.type === "chat.history" ? f.event.data.messages : []));
    expect(got).toHaveLength(100);
    expect(got[0]!.text.startsWith("030 ")).toBe(true);
    expect(got.at(-1)!.text.startsWith("129 ")).toBe(true);
    // 이전 대화
    const first = got[0]!;
    const page = await api("GET", `/rooms/${room.id}/chat?before=${first.seq}&limit=20`, "pl2");
    expect(page.status).toBe(200);
    expect(page.json.messages).toHaveLength(20);
    expect(page.json.messages.at(-1).text.startsWith("029 ")).toBe(true);
    expect(page.json.hasMore).toBe(true);
    expect((await api("GET", `/rooms/${room.id}/chat?before=abc`, "pl2")).status).toBe(400);
    void kp;
    void pl;
  });
});

describe("세션 기록(HTTP)", () => {
  it("참가자가 아니면 볼 수 없다", async () => {
    const { room } = await startedRoom();
    expect((await api("GET", `/rooms/${room.id}/log`, "stranger")).status).toBe(403);
    expect((await api("GET", `/rooms/${room.id}/chat`, "stranger")).status).toBe(403);
    expect((await api("GET", `/rooms/nope/log`, "kp1")).status).toBe(404);
  });

  it("GM은 숨은 기록까지 보고, PL은 공개된 기록만 본다. 비밀 굴림·초안·귓속말은 어느 쪽에도 없다", async () => {
    const { room, kp } = await startedRoom();
    const pl = await connect(room, SEO);
    kp.cmd("handout.create", { title: "초안 편지", body: "초안 본문", visibleTo: "gm" });
    kp.cmd("handout.create", { title: "찢어진 편지", body: "본문", visibleTo: "all" });
    await pl.waitFor(isType("handout.added"));
    kp.cmd("flow.beat.upsert", { name: "비밀 단계", kind: "progress", memo: "", handoutIds: [] });
    kp.cmd("roll.request", { expr: "1d6+99", secret: true });
    await new Promise((r) => setTimeout(r, 400));
    pl.cmd("roll.request", { expr: "1d100" });
    await pl.waitFor(isType("roll.result"));
    await new Promise((r) => setTimeout(r, 400));
    kp.cmd("chat.send", { text: "/w 윤서하 귓속말 단서" });
    await pl.waitFor(isType("chat.posted"));

    const gm = await api("GET", `/rooms/${room.id}/log`, "kp1");
    const mine = await api("GET", `/rooms/${room.id}/log`, "pl1");
    expect(gm.status).toBe(200);
    expect(gm.json.audience).toBe("gm");
    expect(mine.json.audience).toBe("public");
    const types = (r: typeof gm) => r.json.entries.map((e: { kind: string }) => e.kind);
    expect(types(gm)).toEqual(expect.arrayContaining(["session", "handout", "roll"]));
    expect(types(mine)).toEqual(expect.arrayContaining(["session", "handout", "roll"]));
    for (const r of [gm, mine]) {
      const j = JSON.stringify(r.json);
      expect(j).not.toContain("1d6+99");
      expect(j).not.toContain("초안");
      expect(j).not.toContain("귓속말 단서");
    }
    // 참가자용으로 보기(GM): 사용자 없는 시점
    const pub = await api("GET", `/rooms/${room.id}/log?view=public`, "kp1");
    expect(pub.json.audience).toBe("public");
    // 종류 필터와 잘못된 값
    const rolls = await api("GET", `/rooms/${room.id}/log?kinds=roll`, "pl1");
    expect(rolls.json.entries.every((e: { kind: string }) => e.kind === "roll")).toBe(true);
    expect((await api("GET", `/rooms/${room.id}/log?kinds=zzz`, "pl1")).status).toBe(400);
    expect((await api("GET", `/rooms/${room.id}/log?limit=-1`, "pl1")).status).toBe(400);
    // GM의 비트 이동은 PL 쪽에 없다 (기록에 GM만 보이는 줄이 따로 있다)
    kp.cmd("flow.goto", { beatId: (await (async () => { const s = kp.messages.filter(isType("flow.updated")).at(-1); return s && s.event.type === "flow.updated" ? s.event.data.flow.beats[0]!.id : ""; })()) });
    await new Promise((r) => setTimeout(r, 200));
    const gm2 = await api("GET", `/rooms/${room.id}/log?kinds=beat`, "kp1");
    const pl2 = await api("GET", `/rooms/${room.id}/log?kinds=beat`, "pl1");
    expect(gm2.json.entries).toHaveLength(1);
    expect(pl2.json.entries).toHaveLength(0);
  });
});

describe("대화·기록 저장", () => {
  it("서버를 다시 켜도 대화·귓속말·기록·설정이 남고 파일에 schemaVersion이 적힌다", async () => {
    await app.close();
    const dir = mkdtempSync(join(tmpdir(), "coc-vtt-"));
    try {
      const store = new FileRoomRepository(dir);
      ({ app, port } = await boot({ store }));
      base = `http://127.0.0.1:${port}`;
      const room = await makeRoom("대화 룸");
      const kp = await connect(room, GM);
      const pl = await connect(room, SEO);
      kp.cmd("session.start", {});
      await kp.waitFor(isType("session.started"));
      kp.cmd("settings.chat", { plWhisper: true });
      pl.cmd("chat.send", { text: "저장될 말" });
      await kp.waitFor(isType("chat.posted"));
      await new Promise((r) => setTimeout(r, 450));
      kp.cmd("chat.send", { text: "저장될 귓속말", to: "pl1" });
      await pl.waitFor((m) => m.event.type === "chat.posted" && m.event.data.kind === "whisper");
      await app.close();

      const raw = JSON.parse(readFileSync(join(dir, `${room.id}.json`), "utf8"));
      expect(raw.data.schemaVersion).toBe(2);
      expect(raw.data.chat.map((m: { text: string }) => m.text)).toEqual(["저장될 말", "저장될 귓속말"]);
      expect(raw.data.chatSettings).toEqual({ plWhisper: true });
      expect(raw.data.log.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(["start", "say"]));

      ({ app, port } = await boot({ store: new FileRoomRepository(dir) }));
      base = `http://127.0.0.1:${port}`;
      const pl2 = await connect({ id: room.id, invite: "" }, SEO);
      await pl2.waitFor((m) => m.event.type === "chat.history" && m.event.data.last);
      expect(chatHistory(pl2).map((m) => m.text)).toEqual(["저장될 말", "저장될 귓속말"]);
      const han = await connect({ id: room.id, invite: room.invite }, HAN);
      await han.waitFor((m) => m.event.type === "chat.history" && m.event.data.last);
      expect(chatHistory(han).map((m) => m.text)).toEqual(["저장될 말"]);
      const snap = han.messages.find(isType("snapshot"));
      expect(snap?.event.type === "snapshot" && snap.event.data.chatSettings).toEqual({ plWhisper: true });
    } finally {
      await app.close().catch(() => {});
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const chatHistory = (c: Client) => c.messages.flatMap((m) => (m.event.type === "chat.history" ? m.event.data.messages : []));
