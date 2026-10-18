import { resolve } from "node:path";
import type { ApiConfig } from "../config";
import { FileVaultRepository } from "../character/infrastructure/file-vault.repository";
import { MemoryVaultRepository } from "../character/infrastructure/memory-vault.repository";
import { PostgresVaultRepository } from "../character/infrastructure/postgres-vault.repository";
import type { VaultRepository } from "../character/domain/vault-character";
import type { ImageStorage } from "../image/domain/image-storage";
import { FileImageStorage } from "../image/infrastructure/file-image.storage";
import { MemoryImageStorage } from "../image/infrastructure/memory-image.storage";
import { PostgresImageStorage } from "../image/infrastructure/postgres-image.storage";
import { S3ImageStorage } from "../image/infrastructure/s3-image.storage";
import { FileLibraryRepository } from "../library/infrastructure/file-library.repository";
import { MemoryLibraryRepository } from "../library/infrastructure/memory-library.repository";
import { PostgresLibraryRepository } from "../library/infrastructure/postgres-library.repository";
import type { LibraryRepository } from "../library/domain/user-library";
import type { RoomRepository } from "../room/domain/room.repository";
import { FileRoomRepository } from "../room/infrastructure/file-room.repository";
import { MemoryRoomRepository } from "../room/infrastructure/memory-room.repository";
import { PostgresRoomRepository } from "../room/infrastructure/postgres-room.repository";
import { S3Client } from "./s3-client";
import { connectPostgres, migrate, type ClosableDb } from "./postgres";

export interface Stores {
  db: ClosableDb | null;
  store: RoomRepository;
  vault: VaultRepository;
  library: LibraryRepository;
  images: ImageStorage;
  /** 시작 로그용 설명 */
  describe: { rooms: string; images: string };
}

/**
 * 설정에서 저장소 구현을 고른다.
 *   룸·보관함·서재: DATABASE_URL이 있으면 Postgres, 없으면 DATA_DIR 폴더(기본 ./data), DATA_DIR=memory면 메모리
 *   이미지·오디오:  S3_BUCKET이 있으면 S3 호환(R2 등), 아니면 위 규칙을 따른다
 */
export async function buildStores(config: ApiConfig, opts: { migrate?: boolean } = {}): Promise<Stores> {
  const dir = config.dataDir;
  const db = config.databaseUrl ? connectPostgres(config.databaseUrl, { ssl: config.databaseSsl, caCert: config.databaseCaCert, max: config.databasePoolMax }) : null;
  if (db && opts.migrate !== false) await migrate(db);
  const store = db ? new PostgresRoomRepository(db) : dir === "memory" ? new MemoryRoomRepository() : new FileRoomRepository(resolve(dir));
  const vault = db ? new PostgresVaultRepository(db) : dir === "memory" ? new MemoryVaultRepository() : new FileVaultRepository(resolve(dir, "vault"));
  const library = db ? new PostgresLibraryRepository(db) : dir === "memory" ? new MemoryLibraryRepository() : new FileLibraryRepository(resolve(dir, "library"));
  const s3 = config.s3;
  const images: ImageStorage = s3
    ? new S3ImageStorage(new S3Client({ endpoint: s3.endpoint, region: s3.region, bucket: s3.bucket, accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey, forcePathStyle: s3.forcePathStyle }), s3.prefix)
    : db
      ? new PostgresImageStorage(db)
      : dir === "memory"
        ? new MemoryImageStorage()
        : new FileImageStorage(resolve(dir, "images"));
  return {
    db,
    store,
    vault,
    library,
    images,
    describe: { rooms: db ? "postgres" : dir, images: s3 ? `s3(${s3.bucket})` : db ? "postgres" : dir === "memory" ? "memory" : `${dir}/images` },
  };
}
