import "reflect-metadata";
import type { Server } from "node:http";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { WsAdapter } from "@nestjs/platform-ws";
import { AppModule } from "./app.module";
import { ConfigError, authenticateFor, loadConfig } from "./config";
import { errFields, log } from "./platform/log";
import { startCleanupSchedule } from "./maintenance/cleanup-schedule";
import { installProcessGuards } from "./platform/process-guards";
import { buildStores } from "./platform/wiring";
import { APP_VERSION } from "./version";

/** 종료를 기다려 주는 최대 시간. 호스트의 종료 유예(Fly kill_timeout 등)보다 짧게 둔다. */
const SHUTDOWN_DEADLINE_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS) || 8000;

async function bootstrap() {
  const config = loadConfig();
  const stores = await buildStores(config);
  // KP_AWAY_GRACE_MS: GM 연결이 끊긴 뒤 자동 정지까지의 유예(기본 30000ms). 테스트·e2e에서 줄여 쓴다.
  const grace = Number(process.env.KP_AWAY_GRACE_MS);
  const kpAwayGraceMs = Number.isFinite(grace) && grace >= 0 && process.env.KP_AWAY_GRACE_MS ? grace : undefined;
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register({
      authenticate: authenticateFor(config),
      store: stores.store,
      vault: stores.vault,
      library: stores.library,
      images: stores.images,
      db: stores.db,
      trustProxyHops: config.trustProxyHops,
      kpAwayGraceMs,
      httpRate: config.httpRate,
      wsLimits: config.wsLimits,
      roomIdleMinutes: config.roomIdleMinutes,
    }),
    // Nest 기본 로그는 줄 단위 글자라 수집기에서 다루기 어렵다. 오류와 경고만 남기고 나머지는 우리 로그를 쓴다.
    { logger: ["error", "warn"], bodyParser: true },
  );
  app.disable("x-powered-by");
  app.enableCors({ origin: config.webOrigin, exposedHeaders: ["x-export-notes"] });
  app.useWebSocketAdapter(new WsAdapter(app));

  // 프록시(Fly, Render, Cloudflare)의 유휴 연결 제한(보통 60초)보다 길게 둬서 재사용된 연결이 갑자기 끊기는 502를 막는다.
  const http = app.getHttpServer() as Server;
  http.keepAliveTimeout = 65_000;
  http.headersTimeout = 66_000;

  // ── 종료와 오류 처리 ────────────────────────────────────
  // SIGTERM(배포·재시작): 새 연결을 막고, 접속자에게 "서버 재시작"(1012)을 알려 닫고, 모든 룸을 저장한 뒤 끝낸다.
  // 접속자 화면은 1012를 받으면 알아서 다시 붙는다.
  const cleanup = startCleanupSchedule({ store: stores.store, images: stores.images, ...config.imageCleanup });
  let stopping: Promise<void> | null = null;
  const stop = (reason: string, code: number): Promise<void> => {
    if (stopping) return stopping;
    log.info("종료를 시작해요", { reason });
    const force = setTimeout(() => {
      log.error("종료가 늦어져 강제로 끝내요", { deadlineMs: SHUTDOWN_DEADLINE_MS });
      process.exit(code || 1);
    }, SHUTDOWN_DEADLINE_MS);
    force.unref();
    stopping = (async () => {
      cleanup.stop();
      try {
        await app.close(); // Lifecycle이 연결을 닫고 모든 룸을 저장한다
      } catch (e) {
        log.error("종료 중 오류", errFields(e));
        code = code || 1;
      }
      try {
        await stores.db?.close();
      } catch (e) {
        log.error("DB 연결을 닫지 못했어요", errFields(e));
      }
      log.info("종료했어요", { code });
      process.exit(code);
    })();
    return stopping;
  };
  installProcessGuards(stop);

  await app.listen(config.port);
  log.info("api started", {
    version: APP_VERSION,
    port: config.port,
    rooms: stores.describe.rooms,
    images: stores.describe.images,
    auth: config.authMode === "dev" ? "dev(개발용)" : `supabase(${[config.supabaseUrl ? "jwks" : null, config.jwtSecret ? "hs256" : null].filter(Boolean).join("+")})`,
    env: config.production ? "production" : "development",
    trustProxy: config.trustProxyHops,
    webOrigin: config.webOrigin,
    ...(config.imageCleanup.mode !== "off" ? { imageCleanup: config.imageCleanup.mode } : {}),
    ...(config.roomIdleMinutes ? { roomIdleMinutes: config.roomIdleMinutes } : {}),
  });
  for (const w of config.warnings) log.warn(w);
}

bootstrap().catch((e) => {
  if (e instanceof ConfigError) log.error(`설정 오류: ${e.message}`);
  else log.error("시작하지 못했어요", errFields(e));
  process.exit(1);
});
