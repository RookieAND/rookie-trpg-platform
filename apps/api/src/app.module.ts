import { Module, type DynamicModule, type MiddlewareConsumer, type NestModule, type OnModuleDestroy, Inject } from "@nestjs/common";
import { LibraryService } from "./library/application/library.service";
import type { LibraryRepository } from "./library/domain/user-library";
import { MemoryLibraryRepository } from "./library/infrastructure/memory-library.repository";
import { LibraryController } from "./library/interface/http/library.controller";
import { VaultService } from "./character/application/vault.service";
import type { VaultRepository } from "./character/domain/vault-character";
import { MemoryVaultRepository } from "./character/infrastructure/memory-vault.repository";
import { CharactersController } from "./character/interface/http/characters.controller";
import { ImageService, type ImageServiceOptions } from "./image/application/image.service";
import type { ImageStorage } from "./image/domain/image-storage";
import { MemoryImageStorage } from "./image/infrastructure/memory-image.storage";
import { AudioController, ImagesController } from "./image/interface/http/images.controller";
import { AuthService } from "./identity/application/auth.service";
import type { Authenticate } from "./identity/domain/identity";
import { devAuthenticate } from "./identity/infrastructure/dev-authenticate";
import { DiscordNotifier, type NotifierOptions } from "./room/application/discord-notifier";
import type { DiscordGateway } from "./room/domain/discord";
import { HttpDiscordGateway } from "./room/infrastructure/http-discord.gateway";
import { RoomRegistry, type RegistryOptions } from "./room/application/room-registry";
import { ScenarioService } from "./room/application/scenario.service";
import type { RoomRepository } from "./room/domain/room.repository";
import { MemoryRoomRepository } from "./room/infrastructure/memory-room.repository";
import { RoomsController } from "./room/interface/http/rooms.controller";
import { RoomGateway } from "./room/interface/ws/room.gateway";
import { RoomHub, type HubOptions, type WsLimits } from "./room/interface/ws/room.hub";
import { AllExceptionsFilter } from "./platform/all-exceptions.filter";
import { HEALTH_DB, HealthController } from "./platform/health.controller";
import type { Db } from "./platform/postgres";
import { APP_FILTER } from "@nestjs/core";
import { ClientIpResolver } from "./identity/application/client-ip";
import { DEFAULT_HTTP_RATE, createHttpRateLimiter, type HttpRateOptions } from "./platform/http-rate-limit";
import { collectMediaIds } from "./media-refs";
import { SheetImportService, type SheetImportOptions } from "./sheet-import/application/sheet-import.service";
import type { SheetFetch } from "./sheet-import/domain/sheet-import";
import { SheetImportController } from "./sheet-import/interface/http/sheet-import.controller";

export interface AppOptions {
  store?: RoomRepository;
  vault?: VaultRepository;
  library?: LibraryRepository;
  images?: ImageStorage;
  imageOptions?: ImageServiceOptions;
  registry?: Omit<RegistryOptions, "store">;
  authenticate?: Authenticate;
  /** 테스트에서 디스코드 전송을 바꿔 끼운다. */
  discord?: { gateway?: DiscordGateway; notifier?: NotifierOptions };
  joinTimeoutMs?: number;
  hub?: HubOptions;
  /** 구글 시트 가져오기. 테스트에서 바깥 요청(fetch)과 한도를 바꿔 끼운다. */
  sheetImport?: { fetch?: SheetFetch; options?: SheetImportOptions };
  /** 프록시 겹 수. 0이면 X-Forwarded-For를 믿지 않는다. */
  trustProxyHops?: number;
  /** GM 연결이 끊긴 뒤 자동 정지까지의 유예(ms). 기본 30초 */
  kpAwayGraceMs?: number;
  /** /health·/ready가 DB에 닿는지 확인할 때 쓴다. 없으면 DB 항목은 none. */
  db?: Db | null;
  /** 모든 REST 요청의 속도 제한. 생략하면 기본값(IP당 분당 1800, 토큰당 900) */
  httpRate?: Partial<HttpRateOptions>;
  /** 웹소켓 동시 연결 상한(사용자·IP·룸) */
  wsLimits?: Partial<WsLimits>;
  /** 연결 없는 룸을 메모리에서 내리기까지의 분. 0이면 내리지 않는다(기본). */
  roomIdleMinutes?: number;
}

/**
 * 구성 루트. 바운디드 컨텍스트별 폴더(identity, room, character)를 여기서 엮는다.
 * 각 컨텍스트는 domain → application → infrastructure/interface 방향으로만 의존한다.
 */

/** 서버가 내려갈 때 연결을 닫고 마지막 상태를 저장한다. */
class Lifecycle implements OnModuleDestroy {
  constructor(@Inject(RoomHub) private readonly hub: RoomHub) {}
  async onModuleDestroy() {
    await this.hub.shutdown();
  }
}

const HTTP_LIMITER = Symbol("HTTP_LIMITER");

@Module({})
export class AppModule implements NestModule {
  constructor(@Inject(HTTP_LIMITER) private readonly limiter: ReturnType<typeof createHttpRateLimiter>) {}

  /** 모든 REST 경로에 속도 제한을 건다(/health·/ready 제외). */
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(this.limiter).forRoutes("*");
  }

  /** 테스트에서 저장소, 난수, 시계, 인증을 바꿀 수 있게 동적 모듈로 만든다. */
  static register(options: AppOptions = {}): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, RoomsController, CharactersController, LibraryController, ImagesController, AudioController, SheetImportController],
      providers: [
        { provide: HEALTH_DB, useValue: options.db ?? null },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: AuthService, useFactory: () => new AuthService(options.authenticate ?? devAuthenticate) },
        { provide: ClientIpResolver, useFactory: () => new ClientIpResolver(options.trustProxyHops ?? 0) },
        {
          provide: HTTP_LIMITER,
          inject: [ClientIpResolver],
          useFactory: (ips: ClientIpResolver) => createHttpRateLimiter({ ...DEFAULT_HTTP_RATE, ...options.httpRate }, ips, options.trustProxyHops ?? 0),
        },
        {
          provide: RoomRegistry,
          inject: [ImageService],
          useFactory: (images: ImageService) =>
            new RoomRegistry({
              store: options.store ?? new MemoryRoomRepository(),
              // 룸을 지우면 그 룸이 참조하던 이미지·오디오도 함께 지운다.
              onRemoving: async (entry) => void (await images.removeMany(collectMediaIds(entry.room.toData()))),
              ...options.registry,
            }),
        },
        {
          provide: DiscordNotifier,
          useFactory: () => new DiscordNotifier(options.discord?.gateway ?? new HttpDiscordGateway(), options.discord?.notifier),
        },
        {
          provide: RoomHub,
          inject: [RoomRegistry, AuthService, DiscordNotifier, ClientIpResolver],
          useFactory: (registry: RoomRegistry, auth: AuthService, notifier: DiscordNotifier, ips: ClientIpResolver) =>
            new RoomHub(registry, auth, options.joinTimeoutMs, notifier, {
              ipOf: (req) => ips.of(req),
              limits: options.wsLimits,
              ...(options.roomIdleMinutes ? { idleEvictMs: options.roomIdleMinutes * 60_000 } : {}),
              ...options.hub,
              ...(options.kpAwayGraceMs !== undefined ? { kpAwayGraceMs: options.kpAwayGraceMs } : {}),
            }),
        },
        { provide: VaultService, useFactory: () => new VaultService(options.vault ?? new MemoryVaultRepository()) },
        { provide: LibraryService, useFactory: () => new LibraryService(options.library ?? new MemoryLibraryRepository()) },
        { provide: ImageService, useFactory: () => new ImageService(options.images ?? new MemoryImageStorage(), options.imageOptions) },
        { provide: ScenarioService, inject: [ImageService], useFactory: (images: ImageService) => new ScenarioService(images) },
        { provide: SheetImportService, useFactory: () => new SheetImportService(options.sheetImport?.fetch ?? ((url, init) => fetch(url, init)), options.sheetImport?.options) },
        RoomGateway,
        Lifecycle,
      ],
    };
  }
}
