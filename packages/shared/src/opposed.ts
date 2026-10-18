import { josa } from "./josa";
import { LEVEL_LABEL_KO, type PercentRoll, type SuccessLevel } from "./dice";

/**
 * 대항 판정(CoC 7판)과 그룹 판정의 순수 규칙.
 *
 *  - 성공 단계가 높은 쪽이 이긴다(대성공 > 극단적 > 어려운 > 보통 성공). 실패와 대실패는 같은 "실패"로 본다.
 *  - 한쪽만 성공하면 성공한 쪽이 이긴다.
 *  - 둘 다 실패하면 아무도 이기지 못하고 현재 상태가 이어진다(방어하는 쪽 b가 유리: statusQuo).
 *  - 성공 단계가 같으면 기능 값이 높은 쪽이 이긴다. 값도 같거나, 양쪽 모두 특성치(또는 행운)로 굴렸으면
 *    비긴 것이라 다시 굴려야 한다("tie").
 *  - 대항 판정에는 보너스·페널티 주사위, 푸시, 행운을 쓰지 않는다(기록에 시트 판정 조건이 남지 않는다).
 *    7판에서 푸시는 전투가 아닌 판정에만 쓰기 때문이다.
 */

export type OpposedWinner = "a" | "b" | "none" | "tie";
export type OpposedReason = "level" | "value" | "bothFail" | "tie";

const RANK: Record<SuccessLevel, number> = { fumble: 0, failure: 0, regular: 1, hard: 2, extreme: 3, critical: 4 };

/** 대항 판정에서 쓰는 성공 단계 순위(실패와 대실패는 0). */
export const opposedRank = (level: SuccessLevel): number => RANK[level];

export interface OpposedInput {
  level: SuccessLevel;
  /** 굴린 기능·특성치의 값 */
  value: number;
  /** 특성치(STR 등)나 행운으로 굴렸는가 */
  characteristic: boolean;
}

export function resolveOpposed(a: OpposedInput, b: OpposedInput): { winner: OpposedWinner; reason: OpposedReason } {
  const ra = RANK[a.level];
  const rb = RANK[b.level];
  if (ra === 0 && rb === 0) return { winner: "none", reason: "bothFail" };
  if (ra !== rb) return { winner: ra > rb ? "a" : "b", reason: "level" };
  if (a.characteristic && b.characteristic) return { winner: "tie", reason: "tie" };
  if (a.value !== b.value) return { winner: a.value > b.value ? "a" : "b", reason: "value" };
  return { winner: "tie", reason: "tie" };
}

export interface OpposedSideOutcome {
  characterId: string;
  /** 캐릭터 이름 */
  character: string;
  /** 기능·특성치 이름 */
  name: string;
  target: number;
  percent: PercentRoll;
  level: SuccessLevel;
}

/** 대항 판정 결과를 한국어 한 문장으로. 화면·디스코드·기록 파일이 같은 문장을 쓴다. */
export function opposedSummary(a: OpposedSideOutcome, b: OpposedSideOutcome, winner: OpposedWinner, reason: OpposedReason): string {
  const lv = (s: OpposedSideOutcome) => LEVEL_LABEL_KO[s.level];
  if (winner === "tie") {
    return reason === "tie" && lv(a) === lv(b) ? `둘 다 ${lv(a)}에 기능 값까지 같아서 비겼어요. 다시 굴려요.` : "비겼어요. 다시 굴려요.";
  }
  if (winner === "none") return `둘 다 실패했어요. 아무도 이기지 못하고 지금 상태가 이어져요(${josa(b.character, "이/가")} 유리해요).`;
  const win = winner === "a" ? a : b;
  const lose = winner === "a" ? b : a;
  const how = reason === "value" ? `둘 다 ${lv(win)}, 기능 값 ${win.target} 대 ${lose.target}` : `${lv(win)} 대 ${lv(lose)}`;
  return `${josa(win.character, "이/가")} 이겼어요 (${how}).`;
}

export interface GroupEntry {
  characterId: string;
  character: string;
  target: number;
  percent: PercentRoll;
  level: SuccessLevel;
  success: boolean;
}

/** 그룹 판정 요약: 몇 명이 성공했는지와 누가 실패했는지. */
export function groupSummary(name: string, entries: readonly GroupEntry[], skipped: readonly string[] = []): string {
  if (entries.length === 0) return `${josa(name, "을/를")} 굴릴 수 있는 캐릭터가 없어요.`;
  const ok = entries.filter((e) => e.success);
  const bad = entries.filter((e) => !e.success);
  const head = bad.length === 0 ? (entries.length === 1 ? "1명이 성공했어요." : `${entries.length}명 모두 성공했어요.`) : `${entries.length}명 중 ${ok.length}명이 성공했어요. 실패: ${bad.map((e) => e.character).join(", ")}.`;
  const skip = skipped.length ? ` ${josa(name, "이/가")} 없어서 빠진 사람: ${skipped.join(", ")}.` : "";
  return head + skip;
}
