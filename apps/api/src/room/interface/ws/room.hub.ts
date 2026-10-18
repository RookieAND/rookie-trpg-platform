import type { IncomingMessage } from "node:http";
import type { RawData, WebSocket } from "ws";
import { clientEnvelopeSchema, joinSchema, type ErrorCode, type ServerMessage } from "@coc-vtt/shared";
import { inAudience, type Actor, type Out } from "@coc-vtt/room-core";
import type { AuthService } from "../../../identity/application/auth.service";
import type { DiscordNotifier } from "../../application/discord-notifier";
import type { LoadedRoom, RoomRegistry } from "../../application/room-registry";
import { DEFAULT_RATE_LIMIT, MessageRateLimiter, type RateLimitOptions } from "./rate-limit";

/**
 * 연결 허브. ws 연결 하나하나를 룸에 붙이고, 룸이 만든 이벤트를 받을 사람에게 전달한다.
 * 프레임워크(Nest)와 무관한 클래스라서 게이트웨이는 attach()만 부르면 된다.
 */

interface Conn {
  ws: WebSocket;
  actor: Actor;
  joined: boolean;
}

const errorMsg = (code: ErrorCode, message: string, requestId?: string): ServerMessage => ({
  seq: 0,
  event: { type: "error", data: { code, message, ...(requestId ? { requestId } : {}) } },
});

const requestIdOf = (json: unknown): string | undefined =>
  json && typeof json === "object" && "id" in json && typeof (json as { id: unknown }).id === "string"
    ? (json as { id: string }).id.slice(0, 64)
    : undefined;

/** 닫을 때 쓰는 코드. 4401~4409는 다시 붙어도 소용없는 거절이다. */
export const CLOSE = {
  unauthorized: 4401,
  noAccess: 4403,
  notFound: 4404,
  joinTimeout: 4408,
  full: 4409,
  /** 속도 제한을 계속 넘겨 끊긴 경우. 1008(정책 위반)을 쓰므로 클라이언트가 천천히 다시 붙을 수 있다. */
  rateLimited: 1008,
} as const;

export interface HubOptions {
  rate?: Partial<RateLimitOptions>;
  /** 이 간격으로 ping을 보내고, 직전 ping에 응답이 없던 연결은 끊는다. 0이면 끈다. */
  heartbeatMs?: number;
  now?: () => number;
  /** GM의 마지막 연결이 닫힌 뒤 정지하기까지의 유예(ms). 기본 30초 */
  kpAwayGraceMs?: number;
}

export const HEARTBEAT_MS = 30_000;

/** GM의 마지막 연결이 닫힌 뒤 정지하기까지 기다리는 시간. 새로고침·잠깐의 끊김을 넘기기 위한 유예다. */
export const KP_AWAY_GRACE_MS = 30_000;

export class RoomHub {
  private conns = new Map<string, Set<Conn>>();
  /** 룸마다 GM 유예 타이머. 시계는 룸 엔진이 아니라 여기서 쥔다. */
  private graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private closing = false;
  /** 하트비트 대상. 룸에 붙기 전 연결도 포함한다. */
  private alive = new Map<WebSocket, boolean>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private readonly rate: RateLimitOptions;
  private readonly now: () => number;
  private readonly kpAwayGraceMs: number;

  constructor(
    private readonly registry: RoomRegistry,
    private readonly auth: AuthService,
    private readonly joinTimeoutMs = 5000,
    private readonly notifier?: DiscordNotifier,
    opts: HubOptions = {},
  ) {
    this.rate = { ...DEFAULT_RATE_LIMIT, ...opts.rate };
    this.now = opts.now ?? Date.now;
    this.kpAwayGraceMs = opts.kpAwayGraceMs ?? KP_AWAY_GRACE_MS;
    const hb = opts.heartbeatMs ?? HEARTBEAT_MS;
    if (hb > 0) {
      this.heartbeat = setInterval(() => this.sweep(), hb);
      this.heartbeat.unref();
    }
    // 룸이 지워지면 붙어 있던 연결을 모두 끊는다. 4404라 다시 붙으려 하지 않는다.
    registry.onRemoved((roomId) => {
      for (const c of this.conns.get(roomId) ?? []) c.ws.close(CLOSE.notFound, "room_removed");
      this.conns.delete(roomId);
      this.clearGrace(roomId);
    });
  }

  /** 지난 ping에 응답하지 않은 연결은 죽은 것으로 보고 끊는다. 나머지에는 새 ping을 보낸다. */
  private sweep() {
    for (const [ws, ok] of this.alive) {
      if (!ok) {
        this.alive.delete(ws);
        ws.terminate();
        continue;
      }
      this.alive.set(ws, false);
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }

  private clearGrace(roomId: string) {
    const t = this.graceTimers.get(roomId);
    if (t) clearTimeout(t);
    this.graceTimers.delete(roomId);
  }

  /** GM 유예를 시작한다. 시간이 다 될 때까지 GM이 안 돌아오면 룸이 자동 정지한다. */
  private startGrace(entry: LoadedRoom) {
    const roomId = entry.meta.id;
    this.clearGrace(roomId);
    const timer = setTimeout(() => {
      this.graceTimers.delete(roomId);
      if (this.closing) return;
      const outs = entry.room.expireKpAway();
      if (outs.length === 0) return;
      this.deliver(roomId, outs);
      this.notifier?.publish(entry.meta, outs);
      this.registry.markChanged(entry, true);
    }, this.kpAwayGraceMs);
    timer.unref?.();
    this.graceTimers.set(roomId, timer);
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  private deliver(roomId: string, outs: Out[]) {
    const set = this.conns.get(roomId);
    if (!set) return;
    for (const out of outs) {
      for (const c of set) {
        if (c.joined && inAudience(out.audience, c.actor)) {
          this.send(c.ws, { seq: out.seq, event: out.event } as ServerMessage);
        }
      }
    }
  }

  /** 새 ws 연결을 붙인다. 룸을 불러오는 동안 온 메시지는 순서대로 쌓아 둔다. */
  attach(ws: WebSocket, req: IncomingMessage): void {
    const url = new URL(req.url ?? "/", "http://localhost");
    const roomId = url.searchParams.get("room");
    const identity = this.auth.fromRequest(req);
    if (!roomId || !identity) {
      ws.close(CLOSE.unauthorized, "unauthorized");
      return;
    }

    const queue: RawData[] = [];
    let handler: ((raw: RawData) => void) | null = null;
    const limiter = new MessageRateLimiter(this.rate, this.now);
    this.alive.set(ws, true);
    ws.on("pong", () => this.alive.has(ws) && this.alive.set(ws, true));
    ws.on("message", (raw) => {
      // 무엇이든 받았으면 살아 있는 연결이다.
      if (this.alive.has(ws)) this.alive.set(ws, true);
      const verdict = limiter.take();
      if (verdict === "ok") return handler ? handler(raw) : queue.push(raw);
      this.send(ws, errorMsg("rate_limited", "메시지를 너무 빨리 보내고 있어요. 잠시 천천히 해 주세요."));
      if (verdict === "close") ws.close(CLOSE.rateLimited, "rate_limited");
    });
    let closed = false;
    let cleanup: () => void = () => {};
    ws.on("close", () => {
      closed = true;
      this.alive.delete(ws);
      cleanup();
    });
    ws.on("error", () => ws.close());

    void this.registry
      .get(roomId)
      .then((entry) => {
        if (closed) return;
        if (!entry) return ws.close(CLOSE.notFound, "room_not_found");
        const decision = this.registry.decideJoin(entry, identity.userId, identity.requestedRole, url.searchParams.get("invite"));
        if (!decision.ok) {
          return ws.close(decision.reason === "room_full" ? CLOSE.full : CLOSE.noAccess, decision.reason);
        }
        const actor: Actor = { userId: identity.userId, name: identity.name, role: decision.role };
        cleanup = this.bind(ws, entry, actor);
        handler = (raw) => this.onMessage(ws, entry, actor, raw);
        for (const raw of queue.splice(0)) handler(raw);
      })
      .catch(() => ws.close(1011, "internal"));
  }

  private connOf = new WeakMap<WebSocket, Conn>();

  /** 연결을 룸에 등록하고, 닫힐 때 정리하는 함수를 돌려준다. */
  private bind(ws: WebSocket, entry: LoadedRoom, actor: Actor): () => void {
    const roomId = entry.meta.id;
    const conn: Conn = { ws, actor, joined: false };
    this.connOf.set(ws, conn);
    let set = this.conns.get(roomId);
    if (!set) this.conns.set(roomId, (set = new Set()));
    set.add(conn);

    const timer = setTimeout(() => {
      if (!conn.joined) ws.close(CLOSE.joinTimeout, "join_timeout");
    }, this.joinTimeoutMs);

    return () => {
      clearTimeout(timer);
      set.delete(conn);
      // 서버를 내리는 중에는 접속 종료 알림이나 저장을 만들지 않는다(마지막 저장은 shutdown이 한다).
      if (this.closing) return;
      const stillHere = [...set].some((c) => c.joined && c.actor.userId === actor.userId);
      if (conn.joined && !stillHere) {
        const outs = entry.room.leave(actor.userId);
        this.deliver(roomId, outs);
        this.notifier?.publish(entry.meta, outs);
        this.registry.markChanged(entry, true);
        if (entry.room.kpAway !== null) this.startGrace(entry);
      }
      if (set.size === 0) this.conns.delete(roomId);
    };
  }

  private onMessage(ws: WebSocket, entry: LoadedRoom, actor: Actor, raw: RawData) {
    const conn = this.connOf.get(ws);
    if (!conn) return;
    const roomId = entry.meta.id;
    const fail = (code: ErrorCode, message: string, requestId?: string) =>
      this.send(ws, errorMsg(code, message, requestId));

    let json: unknown;
    try {
      json = JSON.parse(raw.toString());
    } catch {
      return fail("bad_message", "JSON이 아니에요.");
    }

    if (!conn.joined) {
      const parsed = joinSchema.safeParse(json);
      if (!parsed.success) return fail("bad_message", "먼저 join 메시지를 보내 주세요.");
      conn.joined = true;
      const presence = entry.room.join(actor);
      const lastSeq = parsed.data.data.lastSeq;
      const missed = lastSeq === undefined ? null : entry.room.eventsSince(actor, lastSeq);
      // 새로 접속한 연결에는 snapshot(또는 놓친 구간)을 먼저 주고, 접속 알림은 그 뒤에 퍼뜨린다.
      if (missed === null) {
        this.send(ws, { seq: 0, event: { type: "snapshot", data: entry.room.snapshot(actor) } });
      } else {
        for (const m of missed) this.send(ws, { seq: m.seq, event: m.event } as ServerMessage);
      }
      const seen = new Set(missed?.map((m) => m.seq));
      const fresh = presence.filter((p) => !seen.has(p.seq));
      this.deliver(roomId, fresh);
      // GM이 유예 안에 돌아왔으면 타이머를 끄고, 자동 정지였다면 재개됐다는 알림도 보낸다.
      if (entry.room.kpAway === null) this.clearGrace(roomId);
      this.notifier?.publish(entry.meta, fresh);
      this.registry.markChanged(entry, fresh.some((p) => p.event.type === "session.resumed"));
      return;
    }

    const parsed = clientEnvelopeSchema.safeParse(json);
    if (!parsed.success) return fail("bad_message", "메시지 형식이 맞지 않아요.", requestIdOf(json));
    const result = entry.room.handle(actor, parsed.data.command);
    const sessionChange = parsed.data.command.type.startsWith("session.");
    if (result.ok) {
      this.deliver(roomId, result.out);
      this.notifier?.publish(entry.meta, result.out);
      // 세션이 바뀌는 순간은 바로 저장한다. 나머지는 잠깐 모아서 저장한다.
      this.registry.markChanged(entry, sessionChange);
      return;
    }
    if (result.out) this.deliver(roomId, result.out);
    fail(result.code, result.message, parsed.data.id);
  }

  /** 서버를 내리기 전에 모든 연결을 닫고 저장한다. */
  async shutdown() {
    this.closing = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const id of [...this.graceTimers.keys()]) this.clearGrace(id);
    for (const set of this.conns.values()) for (const c of set) c.ws.terminate();
    await this.registry.flushAll();
  }
}
