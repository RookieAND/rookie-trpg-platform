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
import { devAuthenticate } from "./identity/infrastructure/dev-authenticate";
import { supabaseAuthenticate } from "./identity/infrastructure/supabase-authenticate";
import { FileImageStorage } from "./image/infrastructure/file-image.storage";
import { MemoryImageStorage } from "./image/infrastructure/memory-image.storage";
import { FileRoomRepository } from "./room/infrastructure/file-room.repository";
import { MemoryRoomRepository } from "./room/infrastructure/memory-room.repository";

async function bootstrap() {
  // DATABASE_URL이 있으면 Postgres(Supabase 포함)에 저장하고, 없으면 ./data 폴더에 파일로 저장한다.
  // DATA_DIR=memory 로 두면 메모리만 쓴다.
  const databaseUrl = process.env.DATABASE_URL;
  const dir = process.env.DATA_DIR ?? "./data";
  const db = databaseUrl ? connectPostgres(databaseUrl) : null;
  if (db) await migrate(db);
  const store = db ? new PostgresRoomRepository(db) : dir === "memory" ? new MemoryRoomRepository() : new FileRoomRepository(resolve(dir));
  const vault = db ? new PostgresVaultRepository(db) : dir === "memory" ? new MemoryVaultRepository() : new FileVaultRepository(resolve(dir, "vault"));
  const library = db ? new PostgresLibraryRepository(db) : dir === "memory" ? new MemoryLibraryRepository() : new FileLibraryRepository(resolve(dir, "library"));
  const images = db ? new PostgresImageStorage(db) : dir === "memory" ? new MemoryImageStorage() : new FileImageStorage(resolve(dir, "images"));
  // SUPABASE_JWT_SECRET이 있으면 디스코드 로그인(Supabase 토큰)만 받고, 없으면 개발용 신원을 쓴다.
  const jwtSecret = process.env.SUPABASE_JWT_SECRET;
  const app = await NestFactory.create(AppModule.register({ authenticate: jwtSecret ? supabaseAuthenticate(jwtSecret) : devAuthenticate, store, vault, library, images }));
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? "http://localhost:3000" });
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();
  if (db) process.once("beforeExit", () => void db.close());
  const port = Number(process.env.PORT ?? 8787);
  await app.listen(port);
  console.log(`api on http://localhost:${port} (ws: /ws, data: ${db ? "postgres" : dir}, auth: ${jwtSecret ? "supabase" : "dev"})`);
}

bootstrap();
