/**
 * 주사위 식 엔진. `eval` 없이 직접 읽고 계산한다.
 *
 * 문법: 숫자, 주사위(`NdM`, `dM`), `db`(굴리는 사람의 피해 보너스), `+ - * /`(나눗셈은 내림 정수),
 * 괄호, 앞에 붙는 `-`. 예: `d100`, `1d6+1d4`, `2d6+6`, `(2d6+6)*5`, `3d6*5`, `1d10+db`.
 *
 * 상한(서버가 지키는 값): 식 길이 400자, 주사위 항 100개, 주사위 모두 합쳐 1000개, 면 수 10000,
 * 계산 도중이나 결과의 크기 ±1,000,000,000, 괄호 깊이 8. 넘으면 사람이 읽을 한국어 오류를 돌려준다.
 */

export const MAX_EXPR_LENGTH = 400;
export const MAX_DICE_TERMS = 100;
export const MAX_DICE_TOTAL = 1000;
export const MAX_DIE_SIDES = 10_000;
export const MAX_EXPR_VALUE = 1_000_000_000;
export const MAX_PAREN_DEPTH = 8;

type Rng = () => number;

export type ExprNode =
  | { t: "num"; v: number }
  | { t: "dice"; n: number; s: number }
  | { t: "db" }
  | { t: "neg"; e: ExprNode }
  | { t: "paren"; e: ExprNode }
  | { t: "bin"; op: "+" | "-" | "*" | "/"; l: ExprNode; r: ExprNode };

export interface ParsedExpr {
  ast: ExprNode;
  /** `db`를 쓰는지. 쓰면 굴릴 때 피해 보너스를 알려 줘야 한다. */
  usesDb: boolean;
  /** `db`가 나온 횟수 */
  dbCount: number;
  /** `db`를 뺀 주사위 항(NdM 하나)의 수 */
  diceTerms: number;
  /** `db`를 뺀 주사위 개수의 합 */
  diceTotal: number;
}

export type ExprParseResult = ({ ok: true } & ParsedExpr) | { ok: false; error: string };

const SYNTAX_ERROR = "식을 읽지 못했어요. 예: 1d6+2, (2d6+6)*5, 1d10+db";

class ExprError extends Error {}

interface Token {
  k: "num" | "dice" | "db" | "op" | "(" | ")";
  text: string;
  n?: number;
  s?: number;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^(\d*)d(\d+)/.exec(rest))) {
      if (m[1] && m[1].length > 4) throw new ExprError(`주사위는 모두 합쳐 ${MAX_DICE_TOTAL}개까지 굴릴 수 있어요.`);
      if (m[2]!.length > 5) throw new ExprError(`면 수는 2~${MAX_DIE_SIDES} 사이여야 해요.`);
      tokens.push({ k: "dice", text: m[0], n: m[1] ? Number(m[1]) : 1, s: Number(m[2]) });
      i += m[0].length;
    } else if ((m = /^db/.exec(rest))) {
      tokens.push({ k: "db", text: "db" });
      i += 2;
    } else if ((m = /^\d+/.exec(rest))) {
      if (m[0].length > 9) throw new ExprError("숫자가 너무 커요.");
      tokens.push({ k: "num", text: m[0], n: Number(m[0]) });
      i += m[0].length;
    } else if ("+-*/".includes(rest[0]!)) {
      tokens.push({ k: "op", text: rest[0]! });
      i += 1;
    } else if (rest[0] === "(" || rest[0] === ")") {
      tokens.push({ k: rest[0] as "(" | ")", text: rest[0] });
      i += 1;
    } else {
      throw new ExprError(SYNTAX_ERROR);
    }
  }
  return tokens;
}

/** 식을 읽는다. 굴리지는 않는다. 공백과 대소문자는 무시한다. */
export function parseDiceExpression(input: string): ExprParseResult {
  if (input.trim().length > MAX_EXPR_LENGTH) return { ok: false, error: `식은 ${MAX_EXPR_LENGTH}자까지 적을 수 있어요.` };
  const text = input.replace(/\s+/g, "").toLowerCase();
  if (!text) return { ok: false, error: "굴림 식이 비어 있어요." };
  try {
    const tokens = tokenize(text);
    let pos = 0;
    let diceTerms = 0;
    let diceTotal = 0;
    let dbCount = 0;

    const peek = () => tokens[pos];
    const parseExpr = (depth: number): ExprNode => {
      let left = parseTerm(depth);
      for (let t = peek(); t && t.k === "op" && (t.text === "+" || t.text === "-"); t = peek()) {
        pos++;
        left = { t: "bin", op: t.text as "+" | "-", l: left, r: parseTerm(depth) };
      }
      return left;
    };
    const parseTerm = (depth: number): ExprNode => {
      let left = parseUnary(depth);
      for (let t = peek(); t && t.k === "op" && (t.text === "*" || t.text === "/"); t = peek()) {
        pos++;
        const right = parseUnary(depth);
        if (t.text === "/" && right.t === "num" && right.v === 0) throw new ExprError("0으로 나눌 수 없어요.");
        left = { t: "bin", op: t.text as "*" | "/", l: left, r: right };
      }
      return left;
    };
    const parseUnary = (depth: number): ExprNode => {
      const t = peek();
      if (t && t.k === "op" && t.text === "-") {
        pos++;
        if (depth > MAX_PAREN_DEPTH) throw new ExprError(SYNTAX_ERROR);
        return { t: "neg", e: parseUnary(depth + 1) };
      }
      return parseAtom(depth);
    };
    const parseAtom = (depth: number): ExprNode => {
      const t = tokens[pos++];
      if (!t) throw new ExprError(SYNTAX_ERROR);
      if (t.k === "num") return { t: "num", v: t.n as number };
      if (t.k === "db") {
        dbCount++;
        diceTerms++;
        if (diceTerms > MAX_DICE_TERMS) throw new ExprError(`주사위 항은 ${MAX_DICE_TERMS}개까지 쓸 수 있어요.`);
        return { t: "db" };
      }
      if (t.k === "dice") {
        const n = t.n as number;
        const s = t.s as number;
        if (n < 1 || n > MAX_DICE_TOTAL) throw new ExprError(`주사위는 1~${MAX_DICE_TOTAL}개까지 굴릴 수 있어요.`);
        if (s < 2 || s > MAX_DIE_SIDES) throw new ExprError(`면 수는 2~${MAX_DIE_SIDES} 사이여야 해요.`);
        diceTerms++;
        diceTotal += n;
        if (diceTerms > MAX_DICE_TERMS) throw new ExprError(`주사위 항은 ${MAX_DICE_TERMS}개까지 쓸 수 있어요.`);
        if (diceTotal > MAX_DICE_TOTAL) throw new ExprError(`주사위는 모두 합쳐 ${MAX_DICE_TOTAL}개까지 굴릴 수 있어요.`);
        return { t: "dice", n, s };
      }
      if (t.k === "(") {
        if (depth >= MAX_PAREN_DEPTH) throw new ExprError(`괄호는 ${MAX_PAREN_DEPTH}겹까지 쓸 수 있어요.`);
        const e = parseExpr(depth + 1);
        if (tokens[pos++]?.k !== ")") throw new ExprError(SYNTAX_ERROR);
        return { t: "paren", e };
      }
      throw new ExprError(SYNTAX_ERROR);
    };

    const ast = parseExpr(0);
    if (pos < tokens.length) throw new ExprError(SYNTAX_ERROR);
    if (diceTerms === 0) return { ok: false, error: "주사위가 하나 이상 있어야 해요. 예: 1d6+2" };
    return { ok: true, ast, usesDb: dbCount > 0, dbCount, diceTerms, diceTotal };
  } catch (e) {
    if (e instanceof ExprError) return { ok: false, error: e.message };
    throw e;
  }
}

/** 평평한 덧셈·뺄셈 식(주사위 하나와 숫자 몇 개, 괄호·곱셈 없음)이면 `NdM±K` 모양으로 줄인다. */
export function simplifyDice(ast: ExprNode): { count: number; sides: number; modifier: number } | null {
  let dice: { n: number; s: number } | null = null;
  let modifier = 0;
  const walk = (node: ExprNode, sign: 1 | -1): boolean => {
    switch (node.t) {
      case "num":
        modifier += sign * node.v;
        return true;
      case "dice":
        if (dice || sign < 0) return false;
        dice = { n: node.n, s: node.s };
        return true;
      case "bin":
        if (node.op === "+") return walk(node.l, sign) && walk(node.r, sign);
        if (node.op === "-") return walk(node.l, sign) && walk(node.r, (sign * -1) as 1 | -1);
        return false;
      default:
        return false;
    }
  };
  if (!walk(ast, 1) || !dice) return null;
  const d = dice as { n: number; s: number };
  return { count: d.n, sides: d.s, modifier };
}

export interface ExprTerm {
  /** 항의 식(예: 2d6, db) */
  text: string;
  /** 굴린 눈(고정값이면 빈 배열) */
  rolls: number[];
  /** 이 항의 합 */
  sum: number;
}

export interface ExprRoll {
  total: number;
  /** 모든 주사위 눈(나온 순서) */
  rolls: number[];
  /** 항별 결과 */
  terms: ExprTerm[];
  /** 눈을 풀어 쓴 계산식. 예: (2d6[3,4]+6)*5 */
  breakdown: string;
}

export type ExprRollResult = ({ ok: true } & ExprRoll) | { ok: false; error: string };

const rollDie = (rng: Rng, sides: number) => Math.floor(rng() * sides) + 1;
const tooBig = () => new ExprError("결과가 너무 커요. ±1,000,000,000 안에서 계산해 주세요.");
const showRolls = (rolls: number[]) => (rolls.length <= 20 ? `[${rolls.join(",")}]` : `[${rolls.length}개, 합 ${rolls.reduce((a, b) => a + b, 0)}]`);

/**
 * 읽은 식을 굴린다. `damageBonus`는 `db`가 가리키는 값("-1", "0", "1d4", "2d6" 같은 문자열)이다.
 * `db`를 쓰는데 값을 안 주면 오류다.
 */
export function evaluateDiceExpression(parsed: ParsedExpr, rng: Rng, damageBonus?: string): ExprRollResult {
  try {
    let db: ParsedExpr | null = null;
    if (parsed.usesDb) {
      if (damageBonus === undefined) return { ok: false, error: "db(피해 보너스)는 캐릭터 시트가 있어야 쓸 수 있어요. 캐릭터를 골라 주세요." };
      const raw = damageBonus.trim() === "" ? "0" : damageBonus.trim();
      const p = parseDiceExpression(raw);
      // 피해 보너스는 숫자 또는 주사위 식이다. 숫자만이면 주사위가 없다는 오류가 나므로 따로 읽는다.
      db = p.ok ? p : parseConstantOnly(raw);
      if (!db) return { ok: false, error: "시트의 피해 보너스를 읽지 못했어요." };
      if (db.usesDb) return { ok: false, error: "시트의 피해 보너스를 읽지 못했어요." };
      const terms = parsed.diceTerms;
      const total = parsed.diceTotal + parsed.dbCount * db.diceTotal;
      if (terms > MAX_DICE_TERMS) return { ok: false, error: `주사위 항은 ${MAX_DICE_TERMS}개까지 쓸 수 있어요.` };
      if (total > MAX_DICE_TOTAL) return { ok: false, error: `주사위는 모두 합쳐 ${MAX_DICE_TOTAL}개까지 굴릴 수 있어요.` };
    }

    const rolls: number[] = [];
    const terms: ExprTerm[] = [];
    const check = (v: number) => {
      if (Math.abs(v) > MAX_EXPR_VALUE) throw tooBig();
      return v;
    };
    const ev = (node: ExprNode, inDb: boolean): { v: number; s: string } => {
      switch (node.t) {
        case "num":
          return { v: node.v, s: String(node.v) };
        case "dice": {
          const mine = Array.from({ length: node.n }, () => rollDie(rng, node.s));
          rolls.push(...mine);
          const sum = check(mine.reduce((a, b) => a + b, 0));
          const label = `${node.n}d${node.s}`;
          if (!inDb) terms.push({ text: label, rolls: mine, sum });
          return { v: sum, s: `${label}${showRolls(mine)}` };
        }
        case "db": {
          const startRolls = rolls.length;
          const inner = ev((db as ParsedExpr).ast, true);
          const mine = rolls.slice(startRolls);
          terms.push({ text: `db(${damageBonus!.trim() || "0"})`, rolls: mine, sum: inner.v });
          return { v: inner.v, s: `db(${inner.s})` };
        }
        case "neg": {
          const inner = ev(node.e, inDb);
          return { v: check(-inner.v), s: `-${inner.s}` };
        }
        case "paren": {
          const inner = ev(node.e, inDb);
          return { v: inner.v, s: `(${inner.s})` };
        }
        case "bin": {
          const l = ev(node.l, inDb);
          const r = ev(node.r, inDb);
          let v: number;
          if (node.op === "+") v = l.v + r.v;
          else if (node.op === "-") v = l.v - r.v;
          else if (node.op === "*") v = l.v * r.v;
          else {
            if (r.v === 0) throw new ExprError("0으로 나눌 수 없어요.");
            v = Math.floor(l.v / r.v);
          }
          return { v: check(v), s: `${l.s}${node.op}${r.s}` };
        }
      }
    };
    const out = ev(parsed.ast, false);
    return { ok: true, total: out.v, rolls, terms, breakdown: out.s };
  } catch (e) {
    if (e instanceof ExprError) return { ok: false, error: e.message };
    throw e;
  }
}

/** 피해 보너스처럼 주사위 없이 숫자만 있는 식("-2", "0")을 읽는다. */
function parseConstantOnly(text: string): ParsedExpr | null {
  const m = /^\s*(-?)\s*(\d{1,4})\s*$/.exec(text);
  if (!m) return null;
  const v = Number(m[2]) * (m[1] ? -1 : 1);
  const ast: ExprNode = v < 0 ? { t: "neg", e: { t: "num", v: -v } } : { t: "num", v };
  return { ast, usesDb: false, dbCount: 0, diceTerms: 0, diceTotal: 0 };
}
