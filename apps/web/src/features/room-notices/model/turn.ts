import type { Initiative } from "@coc-vtt/shared";

/** 지금 차례인 칸이 내 캐릭터인가. NPC 칸(characterId 없음)은 내 차례가 아니다. */
export function isMyTurn(initiative: Initiative | null, characters: { id: string; ownerId: string }[], userId: string): boolean {
  const entry = initiative?.entries[initiative.turn];
  if (!entry?.characterId) return false;
  return characters.some((c) => c.id === entry.characterId && c.ownerId === userId);
}

type TurnObject = { id: string; kind: string; name: string; ownerId?: string };

/** 지금 차례인 칸의 주인(PL). 서버가 채운 ownerId를 먼저 보고, 없으면 내가 아는 캐릭터에서 찾는다. */
export function turnOwnerId(initiative: Initiative | null, characters: { id: string; ownerId: string }[]): string | null {
  const entry = initiative?.entries[initiative.turn];
  if (!entry) return null;
  if (entry.ownerId) return entry.ownerId;
  if (!entry.characterId) return null;
  return characters.find((c) => c.id === entry.characterId)?.ownerId ?? null;
}

/**
 * 지금 차례인 PL의 토큰 id들. 칸 → 캐릭터 주인 → 그 PL의 토큰으로 잇는다.
 * 연결이 없으면(NPC 칸, 토큰 없음) 빈 목록이라 강조하지 않는다.
 * 한 PL에게 토큰이 여럿이면 캐릭터 이름과 같은 토큰만, 같은 이름이 없으면 그 PL의 토큰을 모두 고른다.
 */
export function findTurnTokens(initiative: Initiative | null, characters: { id: string; ownerId: string }[], objects: TurnObject[]): string[] {
  const owner = turnOwnerId(initiative, characters);
  if (!owner) return [];
  const mine = objects.filter((o) => o.kind === "token" && o.ownerId === owner);
  const name = initiative?.entries[initiative.turn]?.name;
  const named = mine.filter((o) => o.name === name);
  return (named.length ? named : mine).map((o) => o.id);
}

/**
 * 차례가 아닌 PL이 자기 토큰을 끌 때 보여 줄 한 줄. 전투 중이 아니거나 내 차례거나 토큰이 차례 토큰이면 null.
 * 같은 칸에서는 한 번만 보이도록 turnKey도 함께 돌려준다.
 */
export function offTurnNotice(initiative: Initiative | null, characters: { id: string; ownerId: string }[], userId: string, draggedId: string, turnTokenIds: string[]): { text: string; turnKey: string } | null {
  const entry = initiative?.entries[initiative.turn];
  if (!initiative || !entry) return null;
  if (turnTokenIds.includes(draggedId) || turnOwnerId(initiative, characters) === userId) return null;
  return { text: `지금은 ${entry.name}의 차례예요`, turnKey: `${initiative.round}:${entry.id}` };
}
