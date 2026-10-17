import type { CharacterData } from "@coc-vtt/shared";

/** 보관함에 저장하는 캐릭터. 룸 안 복사본과 달리 현재 HP·MP·SAN도 함께 들고 있다. */
export interface VaultCharacter extends CharacterData {
  id: string;
  updatedAt: number;
}

/** 사용자 한 명의 보관함 전체를 읽고 쓰는 저장소(포트). 나중에 Postgres로 바꿀 수 있다. */
export interface VaultRepository {
  load(userId: string): Promise<VaultCharacter[]>;
  save(userId: string, characters: VaultCharacter[]): Promise<void>;
}

export const MAX_VAULT_CHARACTERS = 30;
