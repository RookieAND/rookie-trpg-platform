import type { CharacterData } from "@coc-vtt/shared";

/** 보관함에 저장된 캐릭터 */
export interface VaultCharacter extends CharacterData {
  id: string;
  updatedAt: number;
}
