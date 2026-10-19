import type { IncomingMessage } from "node:http";
import type { RawData, WebSocket } from "ws";
import { UNSAFE_KEY_MESSAGE, chunkChatHistory, clientEnvelopeSchema, joinSchema, type ErrorCode, type ServerMessage } from "@coc-vtt/shared";
import { inAudience, type Actor, type Out } from "@coc-vtt/room-core";
import type { AuthService } from "../../../identity/application/auth.service";
import type { Identity } from "../../../identity/domain/identity";
import type { DiscordNotifier } from "../../application/discord-notifier";
import type { LoadedRoom, RoomRegistry } from "../../application/room-registry";
import { errFields, log } from "../../../platform/log";
import { DEFAULT_RATE_LIMIT, MessageRateLimiter, type RateLimitOptions } from "./rate-limit";

/**
 * 연결 허브. ws 연결 하나하나를 룸에 붙이고, 룸이 만든 이벤트를 받을 사람에게 전달한다.
 * 프레임워크(Nest)와 무관한 클래스라서 게이트웨이는 attach()만 부르면 된다.
 */

interface Conn {
  ws: WebSocket;
  actor: Actor;
  joined: boolean;
  /** 이 연결을 연 요청(주소·역할 요청을 읽는 데 쓴다) */
  req: IncomingMessage;
}

/** 동시 연결 상한 */
export interface WsLimits {
  perUser: number;
  perIp: number;
  perRoom: number;
}

export const DEFAULT_WS_LIMITS: WsLimits = { perUser: 8, perIp: 60, perRoom: 150 };

const errorMsg = (code: ErrorCode, message: string, requestId?: string): ServerMessage => ({
  seq: 0,
  event: { type: "error", data: { code, message, ...(requestId ? { requestId } : {}) } },
});

/** 첫 메시지 `{type:"auth", data:{token}}`에서 토큰을 꺼낸다. 모양이 다르면 null. */
function authTokenOf(raw: RawData): string | null {
  try {
    const j = JSON.parse(raw.toString()) as { type?: unknown; data?: { token?: unknown } };
    const t = j?.type === "auth" ? j.data?.token : undefined;
    return typeof t === "string" && t.length > 0 && t.length <= 4096 ? t : null;
  } catch {
    return null;
  }
}

/** 같은 요청에 Authorization 머리글을 얹은 것처럼 보이게 한다(HTTP와 같은 인증 함수를 쓰려고). */
function withBearer(req: IncomingMessage, token: string): IncomingMessage {
  return { headers: { authorization: `Bearer ${token}` }, url: req.url, socket: req.socket } as unknown as IncomingMessage;
}

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
  /** GM이 참가자를 내보냈다. 다시 붙으려 하지 않는다. */
  removed: 4410,
  /** GM이 차단했다. 풀어 줄 때까지 어떤 초대 링크로도 들어올 수 없다. */
  banned: 4411,
  /** 같은 계정의 연결이 너무 많아 가장 오래된 연결을 닫았다. */
  tooManyForUser: 4412,
  /** 같은 IP의 연결이 너무 많다. */
  tooManyForIp: 4413,
  /** 속도 제한을 계속 넘겨 끊긴 경우. 1008(정책 위반)을 쓰므로 클라이언트가 천천히 다시 붙을 수 있다. */
  rateLimited: 1008,
  /** 서버가 내려가는 중(배포·재시작). 1012는 "service restart"라 클라이언트가 곧 다시 붙는다. */
  serverRestarting: 1012,
  /** 연결을 처리하다 서버 쪽 오류가 났다. 룸은 살아 있고, 클라이언트는 다시 붙을 수 있다. */
  internal: 1011,
} as const;

export interface HubOptions {
  rate?: Partial<RateLimitOptions>;
  /** 이 간격으로 ping을 보내고, 직전 ping에 응답이 없던 연결은 끊는다. 0이면 끈다. */
  heartbeatMs?: number;
  now?: () => number;
  /** GM의 마지막 연결이 닫힌 뒤 정지하기까지의 유예(ms). 기본 30초 */
  kpAwayGraceMs?: number;
  /** 종료할 때 연결이 스스로 닫히길 기다리는 시간(ms). 기본 300 */
  closeWaitMs?: number;
  /** 동시 연결 상한(사용자·IP·룸) */
  limits?: Partial<WsLimits>;
  /** 연결한 쪽의 IP를 알아내는 규칙(프록시 설정 포함). 없으면 소켓 주소 */
  ipOf?: (req: IncomingMessage) => string;
  /** 연결이 없는 룸을 메모리에서 내리기까지의 시간(ms). 0이면 내리지 않는다. 기본 0 */
  idleEvictMs?: number;
  /** 연결 직후 로그인 정보를 첫 메시지(auth)로 받을 때 기다리는 시간(ms). 기본은 joinTimeoutMs */
  authWaitMs?: number;
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
  private readonly closeWaitMs: number;
  private readonly limits: WsLimits;
  private readonly ipOf: (req: IncomingMessage) => string;
  private readonly idleEvictMs: number;
  private readonly authWaitMs: number;
  /** IP별 열린 연결 수(로그인 전 연결 포함) */
  private ipCounts = new Map<string, number>();
  /** 사용자별 로그인된 연결. 삽입 순서가 오래된 순이다. */
  private userSockets = new Map<string, Set<WebSocket>>();
  /** 연결별 로그인 만료 시각(ms). 이 시각이 지나면 하트비트 점검에서 닫는다. */
  private expiry = new Map<WebSocket, number>();
  private evicting = false;

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
    this.closeWaitMs = opts.closeWaitMs ?? 300;
    this.limits = { ...DEFAULT_WS_LIMITS, ...opts.limits };
    this.ipOf = opts.ipOf ?? ((req) => req.socket?.remoteAddress ?? "unknown");
    this.idleEvictMs = opts.idleEvictMs ?? 0;
    this.authWaitMs = opts.authWaitMs ?? joinTimeoutMs;
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
    try {
      this.sweepOnce();
    } catch (e) {
      log.error("하트비트 점검 중 오류", errFields(e));
    }
  }

  private sweepOnce() {
    const t = this.now();
    // 로그인 토큰이 만료된 연결은 닫는다. 4401을 받은 화면은 토큰을 새로 받아 다시 붙는다.
    for (const [ws, exp] of this.expiry) {
      if (t >= exp) {
        this.expiry.delete(ws);
        try {
          ws.close(CLOSE.unauthorized, "token_expired");
        } catch {
          ws.terminate();
        }
      }
    }
    void this.evictIdleRooms();
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

  /** 한동안 접속자가 없던 룸을 메모리에서 내린다(저장한 뒤). 하트비트마다 불리고, 테스트에서 직접 부를 수도 있다. */
  async evictIdleRooms(): Promise<string[]> {
    if (this.idleEvictMs <= 0 || this.evicting || this.closing) return [];
    this.evicting = true;
    try {
      return await this.registry.evictIdle(this.idleEvictMs, (id) => (this.conns.get(id)?.size ?? 0) > 0 || this.graceTimers.has(id));
    } catch (e) {
      log.error("쉬는 룸 정리 중 오류", errFields(e));
      return [];
    } finally {
      this.evicting = false;
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
      try {
        const outs = entry.room.expireKpAway();
        if (outs.length === 0) return;
        this.deliver(roomId, outs);
        this.notifier?.publish(entry.meta, outs);
        this.registry.markChanged(entry, true);
      } catch (e) {
        log.error("GM 유예 타이머 처리 실패", { roomId, ...errFields(e) });
      }
    }, this.kpAwayGraceMs);
    timer.unref?.();
    this.graceTimers.set(roomId, timer);
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    } catch (e) {
      // 한 연결의 전송 실패가 다른 연결로 번지지 않게 한다.
      log.warn("메시지를 보내지 못했어요", errFields(e));
    }
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

  /** HTTP 요청 같은 바깥에서 룸 엔진을 움직여 생긴 이벤트를 접속자에게 퍼뜨리고 저장을 예약한다. */
  publish(entry: LoadedRoom, outs: Out[]) {
    this.deliver(entry.meta.id, outs);
    this.notifier?.publish(entry.meta, outs);
    this.registry.markChanged(entry);
  }

  /**
   * 새 ws 연결을 붙인다. 로그인 확인(JWKS 조회가 걸릴 수 있다)과 룸을 불러오는 동안 온 메시지는 순서대로 쌓아 둔다.
   * HTTP와 같은 AuthService를 쓰므로 토큰 검증 규칙이 같다.
   *
   * 로그인 정보는 두 길로 받는다. (1) 주소의 token 쿼리나 Authorization 머리글(예전 방식, 개발용 user/name 쿼리 포함),
   * (2) 연결 직후 첫 메시지 `{type:"auth", data:{token}}`. 웹은 (2)를 써서 토큰이 주소에 남지 않게 한다.
   */
  attach(ws: WebSocket, req: IncomingMessage): void {
    const url = new URL(req.url ?? "/", "http://localhost");
    const roomId = url.searchParams.get("room");

    const queue: RawData[] = [];
    let handler: ((raw: RawData) => void) | null = null;
    /** 첫 메시지로 로그인 정보를 기다리는 중이면 그 메시지를 받을 함수 */
    let authWaiter: ((raw: RawData) => void) | null = null;
    const limiter = new MessageRateLimiter(this.rate, this.now);
    const ip = this.ipOf(req);
    this.alive.set(ws, true);
    ws.on("pong", () => this.alive.has(ws) && this.alive.set(ws, true));
    ws.on("message", (raw) => {
      // 무엇이든 받았으면 살아 있는 연결이다.
      if (this.alive.has(ws)) this.alive.set(ws, true);
      const verdict = limiter.take();
      if (verdict === "ok") return handler ? handler(raw) : authWaiter ? authWaiter(raw) : queue.push(raw);
      this.send(ws, errorMsg("rate_limited", "메시지를 너무 빨리 보내고 있어요. 잠시 천천히 해 주세요."));
      if (verdict === "close") ws.close(CLOSE.rateLimited, "rate_limited");
    });
    let closed = false;
    let cleanup: () => void = () => {};
    // IP별 연결 수. 로그인 전 연결도 센다(로그인 없이 연결만 잔뜩 여는 것을 막는다).
    const ipCount = (this.ipCounts.get(ip) ?? 0) + 1;
    const overIp = ipCount > this.limits.perIp;
    if (!overIp) this.ipCounts.set(ip, ipCount);
    let userId: string | null = null;
    ws.on("close", () => {
      closed = true;
      this.alive.delete(ws);
      this.expiry.delete(ws);
      if (!overIp) {
        const left = (this.ipCounts.get(ip) ?? 1) - 1;
        if (left <= 0) this.ipCounts.delete(ip);
        else this.ipCounts.set(ip, left);
      }
      if (userId) {
        const set = this.userSockets.get(userId);
        set?.delete(ws);
        if (set && set.size === 0) this.userSockets.delete(userId);
      }
      try {
        cleanup();
      } catch (e) {
        log.error("연결 정리 중 오류", { roomId, ...errFields(e) });
      }
    });
    ws.on("error", (e) => {
      log.debug("ws 오류", errFields(e));
      try {
        ws.close();
      } catch {
        /* 이미 닫혔다 */
      }
    });
    if (this.closing) return void ws.close(CLOSE.serverRestarting, "server_restarting");
    if (overIp) return void ws.close(CLOSE.tooManyForIp, "too_many_connections_ip");

    void (async () => {
      let identity = roomId ? await this.auth.fromRequest(req) : null;
      if (closed) return;
      // 주소에 로그인 정보가 없으면 첫 메시지(auth)를 기다린다.
      if (!identity && roomId) {
        identity = await new Promise<Identity | null>((resolve) => {
          const early = queue.shift();
          const timer = setTimeout(() => {
            authWaiter = null;
            resolve(null);
          }, this.authWaitMs);
          timer.unref?.();
          authWaiter = (raw) => {
            authWaiter = null;
            clearTimeout(timer);
            const token = authTokenOf(raw);
            if (!token) return resolve(null);
            void this.auth.fromRequest(withBearer(req, token)).then(resolve, () => resolve(null));
          };
          ws.once("close", () => {
            clearTimeout(timer);
            resolve(null);
          });
          if (early) authWaiter(early);
        });
        if (closed) return;
      }
      if (!roomId || !identity) return void ws.close(CLOSE.unauthorized, "unauthorized");
      const entry = await this.registry.get(roomId);
      if (closed) return;
      if (!entry) return void ws.close(CLOSE.notFound, "room_not_found");
      const decision = this.registry.decideJoin(entry, identity.userId, identity.requestedRole, url.searchParams.get("invite"));
      if (!decision.ok) {
        return void ws.close(decision.reason === "room_full" ? CLOSE.full : decision.reason === "banned" ? CLOSE.banned : CLOSE.noAccess, decision.reason);
      }
      if ((this.conns.get(roomId)?.size ?? 0) >= this.limits.perRoom) return void ws.close(CLOSE.full, "room_connections_full");
      // 같은 계정의 연결이 상한이면 가장 오래된 것을 닫는다(끊긴 줄 모르고 남은 옛 연결이 새 연결을 막지 않게).
      userId = identity.userId;
      let mine = this.userSockets.get(userId);
      if (!mine) this.userSockets.set(userId, (mine = new Set()));
      while (mine.size >= this.limits.perUser) {
        const oldest = mine.values().next().value as WebSocket;
        mine.delete(oldest);
        try {
          oldest.close(CLOSE.tooManyForUser, "too_many_connections_user");
        } catch {
          oldest.terminate();
        }
      }
      mine.add(ws);
      if (identity.expiresAt !== undefined) this.expiry.set(ws, identity.expiresAt);
      const actor: Actor = { userId: identity.userId, name: identity.name, role: decision.role };
      cleanup = this.bind(ws, entry, actor, req);
      handler = (raw) => this.onMessage(ws, entry, actor, raw);
      for (const raw of queue.splice(0)) handler(raw);
    })().catch((e) => {
      log.error("연결을 붙이지 못했어요", { roomId, ...errFields(e) });
      try {
        ws.close(CLOSE.internal, "internal");
      } catch {
        /* 이미 닫혔다 */
      }
    });
  }

  private connOf = new WeakMap<WebSocket, Conn>();

  /** 연결을 룸에 등록하고, 닫힐 때 정리하는 함수를 돌려준다. */
  private bind(ws: WebSocket, entry: LoadedRoom, actor: Actor, req: IncomingMessage): () => void {
    const roomId = entry.meta.id;
    const conn: Conn = { ws, actor, joined: false, req };
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
      try {
        if (conn.joined && !stillHere) {
          const outs = entry.room.leave(actor.userId);
          this.deliver(roomId, outs);
          this.notifier?.publish(entry.meta, outs);
          this.registry.markChanged(entry, true);
          if (entry.room.kpAway !== null) this.startGrace(entry);
        }
      } catch (e) {
        log.error("접속 종료 처리 실패", { roomId, ...errFields(e) });
      }
      if (set.size === 0) this.conns.delete(roomId);
    };
  }

  /**
   * 메시지 하나를 처리한다. 룸 엔진이나 알림에서 예외가 나도 이 연결에 오류를 돌려주고 끝낸다.
   * 다른 룸과 다른 연결, 서버 프로세스는 영향받지 않는다.
   */
  private onMessage(ws: WebSocket, entry: LoadedRoom, actor: Actor, raw: RawData) {
    try {
      this.handleMessage(ws, entry, actor, raw);
    } catch (e) {
      log.error("메시지 처리 중 예외", { roomId: entry.meta.id, userId: actor.userId, ...errFields(e) });
      this.send(ws, errorMsg("internal", "서버에 문제가 생겼어요. 잠시 뒤에 다시 해 주세요."));
    }
  }

  private handleMessage(ws: WebSocket, entry: LoadedRoom, actor: Actor, raw: RawData) {
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

    // 로그인 갱신: 열려 있는 연결에서 새 토큰을 받아 만료 시각을 늘린다(같은 사용자여야 한다).
    if (json && typeof json === "object" && (json as { type?: unknown }).type === "auth") {
      const token = authTokenOf(raw);
      if (!token) return fail("bad_message", "로그인 정보 형식이 맞지 않아요.");
      void this.auth
        .fromRequest(withBearer(conn.req, token))
        .then((id) => {
          if (!id || id.userId !== conn.actor.userId) return void ws.close(CLOSE.unauthorized, "unauthorized");
          if (id.expiresAt !== undefined) this.expiry.set(ws, id.expiresAt);
          else this.expiry.delete(ws);
        })
        .catch(() => ws.close(CLOSE.unauthorized, "unauthorized"));
      return;
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
        // 최근 대화는 snapshot에 싣지 않고 이어서 나눠 보낸다(한 프레임이 16KB를 넘지 않게). 이 사람이 볼 수 있는 것만 담긴다.
        const chunks = chunkChatHistory(entry.room.chatHistory(actor));
        if (chunks.length === 0) this.send(ws, { seq: 0, event: { type: "chat.history", data: { messages: [], last: true } } });
        chunks.forEach((messages, i) => this.send(ws, { seq: 0, event: { type: "chat.history", data: { messages, last: i === chunks.length - 1 } } }));
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
    if (!parsed.success) {
      const unsafe = parsed.error.issues.some((i) => i.message === UNSAFE_KEY_MESSAGE);
      return fail("bad_message", unsafe ? UNSAFE_KEY_MESSAGE : "메시지 형식이 맞지 않아요.", requestIdOf(json));
    }
    const result = entry.room.handle(actor, parsed.data.command);
    const sessionChange = parsed.data.command.type.startsWith("session.");
    if (result.ok) {
      this.deliver(roomId, result.out);
      this.closeRemoved(roomId, result.out);
      this.notifier?.publish(entry.meta, result.out);
      // 세션이 바뀌는 순간은 바로 저장한다. 나머지는 잠깐 모아서 저장한다.
      this.registry.markChanged(entry, sessionChange);
      return;
    }
    if (result.out) this.deliver(roomId, result.out);
    fail(result.code, result.message, parsed.data.id);
  }

  isClosing() {
    return this.closing;
  }

  /** 지금 붙어 있는 ws 연결 수(/health용) */
  connectionCount() {
    return this.alive.size;
  }

  /** member.removed를 받은 사람의 연결을 모두 닫는다(알림이 먼저 나간 뒤에 닫힌다). */
  private closeRemoved(roomId: string, outs: Out[]) {
    for (const out of outs) {
      if (out.event.type !== "member.removed") continue;
      const banned = out.event.data.banned === true;
      for (const uid of out.audience.users ?? []) {
        for (const c of [...(this.conns.get(roomId) ?? [])]) if (c.actor.userId === uid) c.ws.close(banned ? CLOSE.banned : CLOSE.removed, banned ? "banned" : "removed");
      }
    }
  }

  /**
   * 서버를 내리기 전에 새 연결을 막고, 모든 연결에 "서버 재시작"(1012)으로 닫는다는 걸 알린 뒤 저장한다.
   * 클라이언트는 1012를 받으면 알아서 다시 붙는다. 저장이 실패해도 연결은 이미 닫힌 상태로 끝낸다.
   */
  async shutdown() {
    this.closing = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const id of [...this.graceTimers.keys()]) this.clearGrace(id);
    for (const ws of [...this.alive.keys()]) {
      try {
        ws.close(CLOSE.serverRestarting, "server_restarting");
      } catch {
        ws.terminate();
      }
    }
    // 정상 종료 핸드셰이크를 잠깐 기다리고, 안 닫힌 연결은 끊는다.
    await new Promise((r) => setTimeout(r, Math.min(this.closeWaitMs, 1000)));
    for (const ws of [...this.alive.keys()]) ws.terminate();
    await this.registry.flushAll();
  }
}
