import type { Initiative } from "@coc-vtt/shared";

/** 지금 차례인 칸이 내 캐릭터인가. NPC 칸(characterId 없음)은 내 차례가 아니다. */
export function isMyTurn(initiative: Initiative | null, characters: { id: string; ownerId: string }[], userId: string): boolean {
  const entry = initiative?.entries[initiative.turn];
  if (!entry?.characterId) return false;
  return characters.some((c) => c.id === entry.characterId && c.ownerId === userId);
}
