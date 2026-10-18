/**
 * 주사위 엔진. 표기는 BCDice의 크툴루 7판(Cthulhu7th) 시스템을 따른다.
 * 규칙은 공식(수식)만 구현하고 룰북 문장은 담지 않는다.
 */

import type { GroupEntry, OpposedReason, OpposedSideOutcome, OpposedWinner } from "./opposed";
import { MAX_EXPR_LENGTH, evaluateDiceExpression, parseDiceExpression, simplifyDice, type ExprTerm, type ParsedExpr } from "./expr";

export type Rng = () => number; // [0, 1)

export const defaultRng: Rng = () => {
  // 서버에서만 호출한다. 암호학적 난수가 필요하면 crypto로 교체한다.
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return (buf[0] as number) / 2 ** 32;
};

export const rollDie = (rng: Rng, sides: number): number => Math.floor(rng() * sides) + 1;

export type SuccessLevel =
  | "critical"
  | "extreme"
  | "hard"
  | "regular"
  | "failure"
  | "fumble";

export const LEVEL_LABEL_KO: Record<SuccessLevel, string> = {
  critical: "대성공",
  extreme: "극단적 성공",
  hard: "어려운 성공",
  regular: "성공",
  failure: "실패",
  fumble: "대실패",
};

const LEVEL_RANK: Record<SuccessLevel, number> = {
  fumble: 0,
  failure: 1,
  regular: 2,
  hard: 3,
  extreme: 4,
  critical: 5,
};

export type Difficulty = "regular" | "hard" | "extreme" | "critical";

export const half = (v: number) => Math.floor(v / 2);
export const fifth = (v: number) => Math.floor(v / 5);

/** d100 결과와 목표값으로 성공 단계를 정한다. */
export function evaluateLevel(roll: number, value: number): SuccessLevel {
  if (roll === 1) return "critical";
  const fumble = value < 50 ? roll >= 96 : roll === 100;
  if (fumble) return "fumble";
  if (roll <= fifth(value)) return "extreme";
  if (roll <= half(value)) return "hard";
  if (roll <= value) return "regular";
  return "failure";
}

export function meetsDifficulty(level: SuccessLevel, difficulty: Difficulty): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[difficulty];
}

export interface PercentRoll {
  units: number; // 0~9
  tens: number[]; // 각 0~9 (10의 자리 값)
  chosenTens: number;
  bonus: number; // 최종 적용된 보너스(+) / 페널티(-) 주사위 수
  total: number; // 1~100
}

/** 보너스/페널티 주사위가 있는 d100. 10의 자리 주사위를 (|bonus|+1)개 굴려 고른다. */
export function rollPercent(rng: Rng, bonus = 0): PercentRoll {
  const net = Math.max(-2, Math.min(2, bonus));
  const units = Math.floor(rng() * 10);
  const tens: number[] = [];
  for (let i = 0; i < Math.abs(net) + 1; i++) tens.push(Math.floor(rng() * 10));

  const valueOf = (t: number) => (t === 0 && units === 0 ? 100 : t * 10 + units);
  let chosen = tens[0] as number;
  for (const t of tens) {
    if (net > 0 ? valueOf(t) < valueOf(chosen) : net < 0 ? valueOf(t) > valueOf(chosen) : false) {
      chosen = t;
    }
  }
  return { units, tens, chosenTens: chosen, bonus: net, total: valueOf(chosen) };
}

// ── 표기 해석 ─────────────────────────────────────────────

export type ParsedCommand =
  | { kind: "dice"; count: number; sides: number; modifier: number }
  /** 괄호·곱셈·여러 주사위 항·db가 있는 식. 읽은 결과(ast)를 들고 있다가 굴릴 때 계산한다. */
  | { kind: "expr"; source: string; parsed: ParsedExpr }
  | { kind: "cc"; bonus: number; target?: number; difficulty?: Difficulty }
  | { kind: "cbr"; x: number; y: number };

export type ParseResult = { ok: true; command: ParsedCommand } | { ok: false; error: string };

const DIFFICULTY_BY_SUFFIX: Record<string, Difficulty> = {
  r: "regular",
  h: "hard",
  e: "extreme",
  c: "critical",
};

/** 합산 식(SAN 보상 등)의 주사위 총 개수 상한 */
const MAX_SUM_DICE = 100;
const MAX_SUM_SIDES = 1000;

/**
 * 지원 표기(BCDice 7판 호환 + 식):
 *  - NdM, NdM+K, NdM-K, 그리고 `(2d6+6)*5`, `1d6+1d4`, `1d10+db` 같은 식(expr.ts)
 *  - CC, CC<=N, CC(x)<=N, CC(+2), CC-1, CC1<=60h 등
 *  - CBR(x,y)
 */
export function parseCommand(input: string): ParseResult {
  const text = input.trim().replace(/\s+/g, "").toLowerCase();
  if (!text) return { ok: false, error: "굴림 식이 비어 있어요." };
  if (input.trim().length > MAX_EXPR_LENGTH) return { ok: false, error: `식은 ${MAX_EXPR_LENGTH}자까지 적을 수 있어요.` };

  const cbr = /^cbr\((\d{1,3}),(\d{1,3})\)$/.exec(text);
  if (cbr) {
    return { ok: true, command: { kind: "cbr", x: Number(cbr[1]), y: Number(cbr[2]) } };
  }

  // CC, CC(x), CC+2, CC-1, CC2 와 뒤따르는 <=N 과 난이도 접미사
  const cc = /^cc(?:\(([+-]?\d+)\)|([+-]?\d+))?(?:<=(\d{1,3})([rhec])?)?$/.exec(text);
  if (cc) {
    const rawBonus = cc[1] ?? cc[2];
    const bonus = rawBonus === undefined ? 0 : Number(rawBonus);
    const target = cc[3] === undefined ? undefined : Number(cc[3]);
    const suffix = cc[4];
    if (suffix && target === undefined) return { ok: false, error: "난이도를 쓰려면 목표값이 필요해요." };
    const command: ParsedCommand = { kind: "cc", bonus };
    if (target !== undefined) command.target = target;
    if (suffix) command.difficulty = DIFFICULTY_BY_SUFFIX[suffix] as Difficulty;
    return { ok: true, command };
  }

  const expr = parseDiceExpression(text);
  if (!expr.ok) return { ok: false, error: expr.error };
  const flat = simplifyDice(expr.ast);
  if (flat && !expr.usesDb) return { ok: true, command: { kind: "dice", count: flat.count, sides: flat.sides, modifier: flat.modifier } };
  return { ok: true, command: { kind: "expr", source: text, parsed: expr } };
}


// ── 합산 식(SAN 보상 등) ─────────────────────────────────

/** 합산 식 길이 상한. 굴림 요청(roll.request)의 식 길이와 같다. */
export const MAX_SUM_EXPR_LENGTH = 64;

export type SumTerm = { sign: 1 | -1; dice: { count: number; sides: number } } | { sign: 1 | -1; constant: number };
export type SumParseResult = { ok: true; terms: SumTerm[] } | { ok: false; error: string };

/**
 * 주사위 항과 상수를 +/-로 이은 합산 식(예: 1d6+1d4, 1d10+2, 2d6)을 해석한다.
 * 항 하나하나는 parseCommand로 해석하므로 개수·면 수 상한이 같고, 주사위 총 개수도 MAX_DICE까지다.
 * 주사위 항은 더하기만 허용한다(빼는 주사위는 보상 식으로 쓰지 않는다). CC·CBR 같은 판정은 거절한다.
 */
export function parseSumExpression(input: string): SumParseResult {
  const text = input.trim().replace(/\s+/g, "").toLowerCase();
  if (!text) return { ok: false, error: "굴림 식이 비어 있어요." };
  if (input.trim().length > MAX_SUM_EXPR_LENGTH) return { ok: false, error: `식은 ${MAX_SUM_EXPR_LENGTH}자까지 적을 수 있어요.` };
  const bad = { ok: false, error: "주사위 식으로 적어 주세요. 예: 1d6, 1d6+1d4, 1d10+2" } as const;
  const terms: SumTerm[] = [];
  let diceTotal = 0;
  for (const piece of text.split(/(?=[+-])/)) {
    const sign: 1 | -1 = piece.startsWith("-") ? -1 : 1;
    const body = /^[+-]/.test(piece) ? piece.slice(1) : piece;
    if (/^\d{1,5}$/.test(body)) {
      terms.push({ sign, constant: Number(body) });
      continue;
    }
    const parsed = parseCommand(body);
    if (!parsed.ok) return parsed.error.startsWith("식을 읽지") || parsed.error.includes("비어") || parsed.error.includes("주사위가 하나") ? bad : parsed;
    if (parsed.command.kind !== "dice") return bad;
    if (parsed.command.sides > MAX_SUM_SIDES) return { ok: false, error: `면 수는 2~${MAX_SUM_SIDES} 사이여야 해요.` };
    if (sign < 0) return { ok: false, error: "빼는 주사위는 쓸 수 없어요. 상수만 뺄 수 있어요." };
    diceTotal += parsed.command.count;
    if (diceTotal > MAX_SUM_DICE) return { ok: false, error: `주사위는 모두 합쳐 ${MAX_SUM_DICE}개까지 굴릴 수 있어요.` };
    terms.push({ sign, dice: { count: parsed.command.count, sides: parsed.command.sides } });
  }
  if (!terms.some((t) => "dice" in t)) return bad;
  return { ok: true, terms };
}

// ── 실행 ─────────────────────────────────────────────

export type RollOutcome =
  | {
      kind: "dice";
      expr: string;
      /** 굴린 모든 주사위 눈 */
      rolls: number[];
      /** total에서 주사위 눈의 합을 뺀 값. 곱셈·나눗셈이 있는 식에서는 계산 결과와의 차이다. */
      modifier: number;
      total: number;
      /** 식에 여러 항·괄호·곱셈·db가 있을 때만 채운다: 항별 결과 */
      terms?: ExprTerm[];
      /** 같은 경우의 눈을 풀어 쓴 계산식. 예: (2d6[3,4]+6)*5 */
      breakdown?: string;
    }
  | {
      kind: "cc";
      expr: string;
      percent: PercentRoll;
      target?: number;
      level?: SuccessLevel;
      /** 난이도를 지정했을 때만 채워진다. */
      difficulty?: Difficulty;
      success?: boolean;
      /** 행운을 써서 결과를 낮췄다면 쓴 양 */
      luckSpent?: number;
    }
  | {
      kind: "cbr";
      expr: string;
      roll: number;
      x: { target: number; level: SuccessLevel };
      y: { target: number; level: SuccessLevel };
      /** 둘 다 성공(2), 하나만 성공(1), 둘 다 실패(0) */
      successes: 0 | 1 | 2;
    }
  | OpposedOutcome
  | GroupOutcome
  | SanOutcome;

/** 대항 판정 결과. 두 굴림이 한 항목이다(opposed.ts). */
export interface OpposedOutcome {
  kind: "opposed";
  expr: string;
  a: OpposedSideOutcome;
  b: OpposedSideOutcome;
  winner: OpposedWinner;
  reason: OpposedReason;
  /** 둘 다 실패해 현재 상태가 이어진다(방어하는 쪽 b가 유리) */
  statusQuo: boolean;
  summary: string;
}

/** 그룹 판정 결과. 여러 PL이 같은 기능으로 굴린 것을 한 항목으로 묶는다. */
export interface GroupOutcome {
  kind: "group";
  expr: string;
  name: string;
  difficulty?: "regular" | "hard" | "extreme";
  entries: GroupEntry[];
  /** 그 기능이 시트에 없어서 빠진 캐릭터 이름 */
  skipped: string[];
  successes: number;
  summary: string;
}

/** SAN 체크 결과. 굴림 로그에 그대로 남는다. */
export interface SanOutcome {
  kind: "san";
  /** 입력한 손실 식(예: 0/1d6) */
  expr: string;
  percent: PercentRoll;
  target: number;
  level: SuccessLevel;
  success: boolean;
  /** 실제로 깎인 양 */
  loss: number;
  before: number;
  after: number;
  /** 한 번에 5 이상 잃었을 때 굴리는 INT 판정 */
  int?: { roll: number; target: number; success: boolean };
  /** 이번 체크로 새로 생긴 광기(가장 무거운 것) */
  madness?: "temporary" | "indefinite" | "permanent";
  /** 하루 누적 손실(이번 체크 포함) */
  dailyLoss: number;
}

/** 굴림 식이 기댈 수 있는 바깥 값. `db`는 굴리는 캐릭터의 피해 보너스 문자열이다. */
export interface RollContext {
  damageBonus?: string;
}

export function runCommand(command: ParsedCommand, expr: string, rng: Rng, ctx: RollContext = {}): RollOutcome {
  switch (command.kind) {
    case "expr": {
      const r = evaluateDiceExpression(command.parsed, rng, ctx.damageBonus);
      if (!r.ok) throw new Error(r.error); // rollExpression이 먼저 걸러서 알려 준다
      const sum = r.rolls.reduce((a, b) => a + b, 0);
      return { kind: "dice", expr, rolls: r.rolls, modifier: r.total - sum, total: r.total, terms: r.terms, breakdown: r.breakdown };
    }
    case "dice": {
      const rolls = Array.from({ length: command.count }, () => rollDie(rng, command.sides));
      const total = rolls.reduce((a, b) => a + b, 0) + command.modifier;
      return { kind: "dice", expr, rolls, modifier: command.modifier, total };
    }
    case "cc": {
      const percent = rollPercent(rng, command.bonus);
      const outcome: RollOutcome = { kind: "cc", expr, percent };
      if (command.target !== undefined) {
        outcome.target = command.target;
        outcome.level = evaluateLevel(percent.total, command.target);
        if (command.difficulty) {
          outcome.difficulty = command.difficulty;
          outcome.success = meetsDifficulty(outcome.level, command.difficulty);
        } else {
          outcome.success = LEVEL_RANK[outcome.level] >= LEVEL_RANK.regular;
        }
      }
      return outcome;
    }
    case "cbr": {
      const roll = rollDie(rng, 100);
      const xl = evaluateLevel(roll, command.x);
      const yl = evaluateLevel(roll, command.y);
      const ok = (l: SuccessLevel) => (LEVEL_RANK[l] >= LEVEL_RANK.regular ? 1 : 0);
      const successes = (ok(xl) + ok(yl)) as 0 | 1 | 2;
      return {
        kind: "cbr",
        expr,
        roll,
        x: { target: command.x, level: xl },
        y: { target: command.y, level: yl },
        successes,
      };
    }
  }
}

/** 한 번에 해석하고 굴린다. 서버에서만 호출한다. */
export function rollExpression(input: string, rng: Rng = defaultRng, ctx: RollContext = {}): { ok: true; outcome: RollOutcome } | { ok: false; error: string } {
  const parsed = parseCommand(input);
  if (!parsed.ok) return parsed;
  if (parsed.command.kind === "expr") {
    const r = evaluateDiceExpression(parsed.command.parsed, rng, ctx.damageBonus);
    if (!r.ok) return r;
    const sum = r.rolls.reduce((a, b) => a + b, 0);
    return { ok: true, outcome: { kind: "dice", expr: input.trim(), rolls: r.rolls, modifier: r.total - sum, total: r.total, terms: r.terms, breakdown: r.breakdown } };
  }
  return { ok: true, outcome: runCommand(parsed.command, input.trim(), rng, ctx) };
}

// ── 파생 능력치 공식 ─────────────────────────────────────

export interface Characteristics {
  STR: number;
  CON: number;
  SIZ: number;
  DEX: number;
  APP: number;
  INT: number;
  POW: number;
  EDU: number;
}

export function deriveStats(c: Characteristics, age: number) {
  const hp = Math.floor((c.CON + c.SIZ) / 10);
  const mp = Math.floor(c.POW / 5);
  const san = c.POW;

  let mov: number;
  if (c.STR < c.SIZ && c.DEX < c.SIZ) mov = 7;
  else if (c.STR > c.SIZ && c.DEX > c.SIZ) mov = 9;
  else mov = 8;
  if (age >= 40) mov -= Math.min(5, Math.floor((age - 30) / 10));
  mov = Math.max(1, mov);

  const sum = c.STR + c.SIZ;
  let db: string;
  let build: number;
  if (sum <= 64) ((db = "-2"), (build = -2));
  else if (sum <= 84) ((db = "-1"), (build = -1));
  else if (sum <= 124) ((db = "0"), (build = 0));
  else if (sum <= 164) ((db = "1d4"), (build = 1));
  else if (sum <= 204) ((db = "1d6"), (build = 2));
  else {
    const extra = Math.floor((sum - 205) / 80) + 1;
    ((db = `${1 + extra}d6`), (build = 2 + extra));
  }
  return { hp, mp, san, mov, damageBonus: db, build };
}

/** 합산 식을 서버 주사위 엔진으로 굴린다. 결과는 단일 식과 같은 dice 형식이다(rolls는 모든 주사위, modifier는 상수 합). */
export function rollSumExpression(
  input: string,
  rng: Rng = defaultRng,
): { ok: true; outcome: Extract<RollOutcome, { kind: "dice" }> } | { ok: false; error: string } {
  const parsed = parseSumExpression(input);
  if (!parsed.ok) return parsed;
  const rolls: number[] = [];
  let modifier = 0;
  for (const t of parsed.terms) {
    if ("constant" in t) modifier += t.sign * t.constant;
    else {
      const o = runCommand({ kind: "dice", count: t.dice.count, sides: t.dice.sides, modifier: 0 }, input.trim(), rng);
      if (o.kind === "dice") rolls.push(...o.rolls);
    }
  }
  return { ok: true, outcome: { kind: "dice", expr: input.trim(), rolls, modifier, total: rolls.reduce((a, b) => a + b, 0) + modifier } };
}
