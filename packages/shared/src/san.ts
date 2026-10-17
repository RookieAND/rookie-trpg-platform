import { evaluateLevel, parseCommand, rollDie, rollPercent, type Rng, type SanOutcome, type SuccessLevel } from "./dice";

/**
 * SAN 체크. 공식만 구현하고 룰북 문장과 광기 증상표는 담지 않는다.
 *  - d100이 현재 SAN 이하면 성공 손실, 아니면 실패 손실을 굴린다. 대실패면 실패 손실의 최댓값이다.
 *  - 한 번에 5 이상 잃으면 INT 판정을 하고, 성공하면 일시적 광기다.
 *  - 하루 누적 손실이 하루 시작 SAN의 1/5 이상이면 장기 광기다.
 *  - SAN이 0이 되면 영구 광기다.
 */

export type LossExpr = { kind: "fixed"; n: number } | { kind: "dice"; count: number; sides: number; modifier: number };

const parseLossPart = (text: string): LossExpr | null => {
  const t = text.trim().toLowerCase();
  if (/^\d{1,3}$/.test(t)) return { kind: "fixed", n: Number(t) };
  const p = parseCommand(t);
  if (p.ok && p.command.kind === "dice") return { kind: "dice", count: p.command.count, sides: p.command.sides, modifier: p.command.modifier };
  return null;
};

/** "성공 시/실패 시" 형식(예: 0/1d6)을 읽는다. */
export function parseSanLoss(input: string): { ok: true; success: LossExpr; failure: LossExpr } | { ok: false; error: string } {
  const parts = input.split("/");
  if (parts.length !== 2) return { ok: false, error: "SAN 손실은 0/1d6처럼 '성공 시/실패 시'로 적어 주세요." };
  const success = parseLossPart(parts[0] as string);
  const failure = parseLossPart(parts[1] as string);
  if (!success || !failure) return { ok: false, error: "손실은 숫자나 1d6 같은 주사위 식이어야 해요." };
  return { ok: true, success, failure };
}

export const maxLoss = (e: LossExpr) => (e.kind === "fixed" ? e.n : Math.max(0, e.count * e.sides + e.modifier));

export const rollLoss = (e: LossExpr, rng: Rng) => {
  if (e.kind === "fixed") return e.n;
  let total = e.modifier;
  for (let i = 0; i < e.count; i++) total += rollDie(rng, e.sides);
  return Math.max(0, total);
};

const passes = (l: SuccessLevel) => l !== "failure" && l !== "fumble";

export interface SanCheckInput {
  rng: Rng;
  expr: string;
  san: number;
  int: number;
  /** 하루 시작 SAN과 오늘 지금까지 잃은 양 */
  day: { start: number; lost: number };
}

export function resolveSanCheck(i: SanCheckInput): { ok: true; outcome: SanOutcome } | { ok: false; error: string } {
  const parsed = parseSanLoss(i.expr);
  if (!parsed.ok) return parsed;

  const percent = rollPercent(i.rng, 0);
  const level = evaluateLevel(percent.total, i.san);
  const success = passes(level);
  const loss = Math.min(i.san, success ? rollLoss(parsed.success, i.rng) : level === "fumble" ? maxLoss(parsed.failure) : rollLoss(parsed.failure, i.rng));
  const after = i.san - loss;
  const dailyLoss = i.day.lost + loss;

  const outcome: SanOutcome = { kind: "san", expr: i.expr.trim(), percent, target: i.san, level, success, loss, before: i.san, after, dailyLoss };

  if (loss >= 5 && after > 0) {
    const roll = rollPercent(i.rng, 0).total;
    outcome.int = { roll, target: i.int, success: passes(evaluateLevel(roll, i.int)) };
  }

  const threshold = Math.floor(i.day.start / 5);
  if (after === 0 && loss > 0) outcome.madness = "permanent";
  else if (threshold > 0 && loss > 0 && dailyLoss >= threshold) outcome.madness = "indefinite";
  else if (outcome.int?.success) outcome.madness = "temporary";
  return { ok: true, outcome };
}
