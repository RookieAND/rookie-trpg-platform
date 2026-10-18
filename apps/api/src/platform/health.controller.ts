import { Controller, Get, Header, HttpException, Inject } from "@nestjs/common";
import type { Db } from "./postgres";
import { RoomRegistry } from "../room/application/room-registry";
import { RoomHub } from "../room/interface/ws/room.hub";
import { APP_VERSION } from "../version";

export const HEALTH_DB = Symbol("HEALTH_DB");

/** DB에 가볍게 물어본다. 2초 안에 답이 없으면 실패로 본다. */
async function probe(db: Db | null, timeoutMs = 2000): Promise<{ status: "ok" | "error" | "none"; latencyMs?: number }> {
  if (!db) return { status: "none" };
  const t0 = Date.now();
  try {
    await Promise.race([db.query("select 1"), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs).unref())]);
    return { status: "ok", latencyMs: Date.now() - t0 };
  } catch {
    return { status: "error" };
  }
}

/**
 * 배포 확인용 두 주소. 비밀이나 설정 값은 싣지 않는다.
 *  - GET /health : 살아 있는지(liveness). 프로세스가 응답하면 항상 200이고, 내용으로 상태(ok/degraded)를 알린다.
 *                  DB가 잠깐 안 된다고 호스트가 서버를 재시작하지 않도록 상태 코드는 바꾸지 않는다.
 *  - GET /ready  : 손님을 받아도 되는지(readiness). 내려가는 중이거나 DB에 닿지 않으면 503.
 */
@Controller()
export class HealthController {
  constructor(
    @Inject(RoomRegistry) private readonly registry: RoomRegistry,
    @Inject(RoomHub) private readonly hub: RoomHub,
    @Inject(HEALTH_DB) private readonly db: Db | null,
  ) {}

  @Get("health")
  @Header("Cache-Control", "no-store")
  async health() {
    const db = await probe(this.db);
    const saves = this.registry.saveStats();
    const degraded = db.status === "error" || saves.consecutiveSaveFailures > 0 || this.hub.isClosing();
    return {
      ok: true,
      status: this.hub.isClosing() ? "shutting_down" : degraded ? "degraded" : "ok",
      version: APP_VERSION,
      uptimeSec: Math.floor(process.uptime()),
      rooms: this.registry.roomCount(),
      connections: this.hub.connectionCount(),
      db,
      saves: { failed: saves.failedSaves, consecutiveFailures: saves.consecutiveSaveFailures },
    };
  }

  @Get("ready")
  @Header("Cache-Control", "no-store")
  async ready() {
    if (this.hub.isClosing()) throw new HttpException({ ready: false, reason: "shutting_down" }, 503);
    const db = await probe(this.db);
    if (db.status === "error") throw new HttpException({ ready: false, reason: "db_unreachable" }, 503);
    return { ready: true, db: db.status };
  }
}
