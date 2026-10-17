import type { IncomingMessage } from "node:http";
import type { RawData, WebSocket } from "ws";
import { clientEnvelopeSchema, joinSchema, type ErrorCode, type ServerMessage } from "@coc-vtt/shared";
import { inAudience, type Actor, type Out } from "@coc-vtt/room-core";
import type { AuthService } from "../../../identity/application/auth.service";
import type { DiscordNotifier } from "../../application/discord-notifier";
import type { LoadedRoom, RoomRegistry } from "../../application/room-registry";

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
} as const;

export class RoomHub {
  private conns = new Map<string, Set<Conn>>();
  private closing = false;

  constructor(
    private readonly registry: RoomRegistry,
    private readonly auth: AuthService,
    private readonly joinTimeoutMs = 5000,
    private readonly notifier?: DiscordNotifier,
  ) {}

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
    ws.on("message", (raw) => (handler ? handler(raw) : queue.push(raw)));
    let closed = false;
    let cleanup: () => void = () => {};
    ws.on("close", () => {
      closed = true;
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
      this.deliver(roomId, presence.filter((p) => !seen.has(p.seq)));
      this.registry.markChanged(entry);
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
    for (const set of this.conns.values()) for (const c of set) c.ws.terminate();
    await this.registry.flushAll();
  }
}
