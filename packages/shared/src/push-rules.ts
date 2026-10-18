import type { RollOutcome } from "./dice";

/**
 * 푸시·행운 규칙(CoC 7판). 서버가 거절하는 기준이자 화면이 버튼을 숨기거나 막는 기준이다.
 * 막을 사유가 있으면 사람이 읽을 한 줄을, 아니면 null을 돌려준다.
 */
export interface RollRuleInput {
  /** 판정한 기능·특성치 이름 */
  name: string;
  outcome: RollOutcome;
  /** 이 굴림이 푸시 굴림이다 */
  isPush: boolean;
  /** 이 굴림을 이미 푸시했다 */
  pushed: boolean;
  /** 이 굴림에 이미 행운을 썼다 */
  luckUsed: boolean;
  /** 캐릭터 무기가 공격에 쓰는 기능 이름들 */
  weaponSkills: readonly string[];
}

const isLuck = (name: string) => name === "행운" || name.toUpperCase() === "LUCK";
const isSan = (name: string) => name.toUpperCase() === "SAN";
/** 격투·사격 계열이거나 무기의 공격 기능이면 전투 판정이다. */
const isCombat = (name: string, weaponSkills: readonly string[]) =>
  name.includes("격투") || name.includes("사격") || weaponSkills.includes(name);

export function pushBlockReason(i: RollRuleInput): string | null {
  if (i.outcome.kind !== "cc") return "시트로 굴린 판정만 푸시할 수 있어요.";
  if (i.outcome.success !== false) return "실패한 판정만 푸시할 수 있어요.";
  if (i.isPush) return "푸시한 굴림은 다시 푸시할 수 없어요.";
  if (i.pushed) return "이미 푸시한 굴림이에요.";
  if (i.luckUsed) return "행운을 쓴 굴림은 푸시할 수 없어요.";
  if (isLuck(i.name)) return "행운 판정은 푸시할 수 없어요.";
  if (isSan(i.name)) return "SAN 체크는 푸시할 수 없어요.";
  if (isCombat(i.name, i.weaponSkills)) return "전투(격투·사격) 판정은 푸시할 수 없어요.";
  if (i.outcome.level === "fumble") return "대실패는 푸시할 수 없어요.";
  return null;
}

export function luckBlockReason(i: RollRuleInput): string | null {
  if (i.outcome.kind !== "cc") return "시트로 굴린 판정에만 행운을 쓸 수 있어요.";
  if (i.luckUsed) return "이미 행운을 쓴 굴림이에요.";
  if (i.isPush) return "푸시한 굴림에는 행운을 쓸 수 없어요.";
  if (i.pushed) return "푸시한 굴림에는 행운을 쓸 수 없어요.";
  if (isLuck(i.name)) return "행운 판정에는 행운을 쓸 수 없어요.";
  if (isSan(i.name)) return "SAN 체크에는 행운을 쓸 수 없어요.";
  return null;
}
