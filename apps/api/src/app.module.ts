import { Module, type DynamicModule, type OnModuleDestroy, Inject } from "@nestjs/common";
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
import type { RoomRepository } from "./room/domain/room.repository";
import { MemoryRoomRepository } from "./room/infrastructure/memory-room.repository";
import { RoomsController } from "./room/interface/http/rooms.controller";
import { RoomGateway } from "./room/interface/ws/room.gateway";
import { RoomHub } from "./room/interface/ws/room.hub";

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

@Module({})
export class AppModule {
  /** 테스트에서 저장소, 난수, 시계, 인증을 바꿀 수 있게 동적 모듈로 만든다. */
  static register(options: AppOptions = {}): DynamicModule {
    return {
      module: AppModule,
      controllers: [RoomsController, CharactersController, LibraryController, ImagesController, AudioController],
      providers: [
        { provide: AuthService, useFactory: () => new AuthService(options.authenticate ?? devAuthenticate) },
        {
          provide: RoomRegistry,
          useFactory: () => new RoomRegistry({ store: options.store ?? new MemoryRoomRepository(), ...options.registry }),
        },
        {
          provide: DiscordNotifier,
          useFactory: () => new DiscordNotifier(options.discord?.gateway ?? new HttpDiscordGateway(), options.discord?.notifier),
        },
        {
          provide: RoomHub,
          inject: [RoomRegistry, AuthService, DiscordNotifier],
          useFactory: (registry: RoomRegistry, auth: AuthService, notifier: DiscordNotifier) =>
            new RoomHub(registry, auth, options.joinTimeoutMs, notifier),
        },
        { provide: VaultService, useFactory: () => new VaultService(options.vault ?? new MemoryVaultRepository()) },
        { provide: LibraryService, useFactory: () => new LibraryService(options.library ?? new MemoryLibraryRepository()) },
        { provide: ImageService, useFactory: () => new ImageService(options.images ?? new MemoryImageStorage(), options.imageOptions) },
        RoomGateway,
        Lifecycle,
      ],
    };
  }
}
