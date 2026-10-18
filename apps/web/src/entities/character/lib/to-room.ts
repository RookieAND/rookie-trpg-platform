import type { CharacterInput } from "@coc-vtt/shared";
import type { VaultCharacter } from "../model/types";

/** 보관함 캐릭터를 룸에 올리는 `character.add` 데이터로 바꾼다(복사본이 만들어지고 보관함 원본과 이어진다). */
export function toRoomCharacter(c: VaultCharacter) {
  return {
    vaultId: c.id,
    name: c.name,
    age: c.age,
    occupation: c.occupation,
    characteristics: c.characteristics,
    luck: c.luck,
    hp: c.hp,
    mp: c.mp,
    san: c.san,
    skills: c.skills,
    notes: c.notes,
    backstory: c.backstory ?? "",
    possessions: c.possessions ?? "",
    weapons: c.weapons ?? [],
  } satisfies CharacterInput & { vaultId: string };
}
