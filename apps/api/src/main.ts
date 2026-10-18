import "reflect-metadata";
import { resolve } from "node:path";
import { NestFactory } from "@nestjs/core";
import { WsAdapter } from "@nestjs/platform-ws";
import { AppModule } from "./app.module";
import { PostgresVaultRepository } from "./character/infrastructure/postgres-vault.repository";
import { FileLibraryRepository } from "./library/infrastructure/file-library.repository";
import { MemoryLibraryRepository } from "./library/infrastructure/memory-library.repository";
import { PostgresLibraryRepository } from "./library/infrastructure/postgres-library.repository";
import { PostgresImageStorage } from "./image/infrastructure/postgres-image.storage";
import { PostgresRoomRepository } from "./room/infrastructure/postgres-room.repository";
import { connectPostgres, migrate } from "./platform/postgres";
import { FileVaultRepository } from "./character/infrastructure/file-vault.repository";
import { MemoryVaultRepository } from "./character/infrastructure/memory-vault.repository";
import { ConfigError, authenticateFor, loadConfig } from "./config";
import { redactWebhooks } from "./room/domain/discord";
import { APP_VERSION } from "./version";
import { FileImageStorage } from "./image/infrastructure/file-image.storage";
import { MemoryImageStorage } from "./image/infrastructure/memory-image.storage";
import { FileRoomRepository } from "./room/infrastructure/file-room.repository";
import { MemoryRoomRepository } from "./room/infrastructure/memory-room.repository";

const fmt = (e: unknown) => redactWebhooks(e instanceof Error ? (e.stack ?? e.message) : String(e));

async function bootstrap() {
  const config = loadConfig();
  // DATABASE_URL이 있으면 Postgres(Supabase 포함)에 저장하고, 없으면 ./data 폴더에 파일로 저장한다.
  // DATA_DIR=memory 로 두면 메모리만 쓴다.
  const dir = config.dataDir;
  const db = config.databaseUrl ? connectPostgres(config.databaseUrl) : null;
  if (db) await migrate(db);
  const store = db ? new PostgresRoomRepository(db) : dir === "memory" ? new MemoryRoomRepository() : new FileRoomRepository(resolve(dir));
  const vault = db ? new PostgresVaultRepository(db) : dir === "memory" ? new MemoryVaultRepository() : new FileVaultRepository(resolve(dir, "vault"));
  const library = db ? new PostgresLibraryRepository(db) : dir === "memory" ? new MemoryLibraryRepository() : new FileLibraryRepository(resolve(dir, "library"));
  const images = db ? new PostgresImageStorage(db) : dir === "memory" ? new MemoryImageStorage() : new FileImageStorage(resolve(dir, "images"));
  // SUPABASE_JWT_SECRET이 있으면 디스코드 로그인(Supabase 토큰)만 받는다.
  // 없으면 개발용 신원을 쓰는데, production에서는 ALLOW_DEV_AUTH=1이 아니면 loadConfig가 부팅을 거부한다.
  // KP_AWAY_GRACE_MS: GM 연결이 끊긴 뒤 자동 정지까지의 유예(기본 30000ms). 테스트·e2e에서 줄여 쓴다.
  const grace = Number(process.env.KP_AWAY_GRACE_MS);
  const kpAwayGraceMs = Number.isFinite(grace) && grace >= 0 && process.env.KP_AWAY_GRACE_MS ? grace : undefined;
  const app = await NestFactory.create(
    AppModule.register({ authenticate: authenticateFor(config), store, vault, library, images, trustProxyHops: config.trustProxyHops, kpAwayGraceMs }),
  );
  app.enableCors({ origin: config.webOrigin, exposedHeaders: ["x-export-notes"] });
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks(); // SIGTERM/SIGINT 때 연결을 닫고 마지막 상태를 저장한 뒤 종료한다.
  if (db) process.once("beforeExit", () => void db.close());

  // 처리 못 한 오류는 기록한다. 거절된 약속은 로그만 남기고 계속 돌고,
  // 잡히지 않은 예외는 상태를 믿을 수 없으니 저장하고 내려간다(프로세스 관리자가 다시 띄운다).
  process.on("unhandledRejection", (reason) => console.error("[unhandledRejection]", fmt(reason)));
  process.on("uncaughtException", (err) => {
    console.error("[uncaughtException]", fmt(err));
    const force = setTimeout(() => process.exit(1), 5000);
    force.unref();
    app.close().finally(() => process.exit(1));
  });

  await app.listen(config.port);
  const warn = config.warnings.length ? `\n  ${config.warnings.map((w) => `[경고] ${w}`).join("\n  ")}` : "";
  console.log(
    `api v${APP_VERSION} on http://localhost:${config.port} (ws: /ws, data: ${db ? "postgres" : dir}, auth: ${config.authMode}${config.authMode === "dev" ? " (개발용)" : ""}, env: ${config.production ? "production" : "development"}, proxy: ${config.trustProxyHops})${warn}`,
  );
}

bootstrap().catch((e) => {
  if (e instanceof ConfigError) console.error(`설정 오류: ${e.message}`);
  else console.error("시작하지 못했어요:", fmt(e));
  process.exit(1);
});
