import { josa } from "./josa";
import { evaluateLevel, meetsDifficulty, type RollOutcome } from "./dice";

type CcOutcome = Extract<RollOutcome, { kind: "cc" }>;

const passes = (level: string) => level !== "failure" && level !== "fumble";

/**
 * 실패한 판정을 성공으로 바꾸는 데 필요한 행운. 결과를 1:1로 낮추는 규칙이다.
 * 목표값과 결과가 있는 실패한 CC 굴림만 해당하고, 바꿀 수 없으면 null이다.
 */
export function luckNeeded(o: RollOutcome): number | null {
  if (o.kind !== "cc" || o.target === undefined || o.success !== false) return null;
  const diff = o.difficulty ?? "regular";
  const limit = diff === "extreme" ? Math.floor(o.target / 5) : diff === "hard" ? Math.floor(o.target / 2) : o.target;
  if (limit < 1) return null;
  const points = o.percent.total - limit;
  return points >= 1 ? points : null;
}

/** 행운을 쓴 뒤의 결과. 굴림 값에서 points를 빼고 단계와 성공 여부를 다시 계산한다. */
export function applyLuck(o: CcOutcome, points: number): CcOutcome {
  const total = Math.max(1, o.percent.total - points);
  const target = o.target as number;
  const level = evaluateLevel(total, target);
  const success = o.difficulty ? meetsDifficulty(level, o.difficulty) : passes(level);
  return { ...o, percent: { ...o.percent, total }, level, success, luckSpent: (o.luckSpent ?? 0) + points };
}

/** 행운을 쓴 굴림의 설명 한 줄. 숫자 뒤 조사도 읽는 소리에 맞춘다(행운 32를 써서 62가 30이 됐어요). */
export function luckSpentText(spent: number, total: number): string {
  return `행운 ${josa(String(spent), "을/를")} 써서 ${josa(String(total + spent), "이/가")} ${josa(String(total), "이/가")} 됐어요.`;
}
