import { CHARACTERISTIC_KEYS, type Character } from "@coc-vtt/shared";

/** 굴림 식 입력칸에 이름을 적을 때 보여 주는 자동완성 계산. 화면과 상관없는 순수 함수라 따로 시험한다. */

export type SkillDifficulty = "regular" | "hard" | "extreme";

export interface SkillOption {
  /** 서버가 시트에서 찾는 이름(기능 이름, STR 같은 특성치, 행운) */
  name: string;
  value: number;
  kind: "skill" | "stat" | "luck";
}

export interface SkillQuery {
  /** 난이도·보너스를 뗀 이름 부분 */
  name: string;
  difficulty?: SkillDifficulty;
  /** 보너스(+) 또는 페널티(-) 주사위, -2~2 */
  bonus: number;
}

const DIFFICULTY_WORDS: Record<string, SkillDifficulty> = {
  보통: "regular", regular: "regular", r: "regular",
  어려움: "hard", 하드: "hard", hard: "hard", h: "hard",
  극단: "extreme", 극한: "extreme", extreme: "extreme", ex: "extreme", e: "extreme",
};

/** 이 기능 이름 목록에서 쓸 수 있는 시트의 기능·특성치·행운을 모은다. */
export function skillOptions(c: Character): SkillOption[] {
  const out: SkillOption[] = Object.entries(c.skills)
    .map(([name, e]): SkillOption => ({ name, value: e.value, kind: "skill" }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  for (const k of CHARACTERISTIC_KEYS) out.push({ name: k, value: c.characteristics[k], kind: "stat" });
  out.push({ name: "행운", value: c.luck, kind: "luck" });
  return out;
}

/**
 * 입력 글을 이름·난이도·보너스로 나눈다. `관찰력`, `관찰력 어려움`, `관찰력 +1`, `관찰력 하드 -1`,
 * 코코포리아처럼 `CC<=관찰력`도 받는다. 이름이 비면 null.
 */
export function parseSkillQuery(raw: string): SkillQuery | null {
  let text = raw.trim();
  const cc = /^cc\s*<=\s*(.*)$/i.exec(text);
  if (cc) text = (cc[1] ?? "").trim();
  if (!text) return null;
  const tokens = text.split(/\s+/);
  let bonus = 0;
  let difficulty: SkillDifficulty | undefined;
  let seenBonus = false;
  while (tokens.length > 1) {
    const last = (tokens[tokens.length - 1] ?? "").toLowerCase();
    if (!seenBonus && /^[+-][12]$/.test(last)) {
      bonus = Number(last);
      seenBonus = true;
    } else if (difficulty === undefined && DIFFICULTY_WORDS[last]) {
      difficulty = DIFFICULTY_WORDS[last];
    } else break;
    tokens.pop();
  }
  const name = tokens.join(" ");
  return { name, ...(difficulty ? { difficulty } : {}), bonus };
}

/** 주사위 식처럼 보이는 입력(숫자·기호로 시작, 1d6, d, db, cc 판정)은 이름으로 보지 않는다. */
export function looksLikeDice(raw: string): boolean {
  const t = raw.trim().replace(/\s+/g, "").toLowerCase();
  if (!t) return true;
  if (/^[\d(+\-*/]/.test(t)) return true;
  if (/^\d*d\d*$/.test(t) || /^db/.test(t)) return true;
  if (/^cbr\(/.test(t)) return true;
  if (/^cc([+-]?\d+|\([+-]?\d+\))?(<=\d.*)?$/.test(t)) return true;
  return false;
}

const CHOSEONG = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";

/** 한글 글자를 초성으로 바꾼다. 한글이 아닌 글자는 그대로 둔다. */
export function toChoseong(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    out += code >= 0xac00 && code <= 0xd7a3 ? (CHOSEONG[Math.floor((code - 0xac00) / 588)] ?? ch) : ch;
  }
  return out;
}

export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

function score(opt: SkillOption, q: string, qJamo: boolean): number | null {
  const n = normalizeName(opt.name);
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.includes(q)) return 2;
  if (qJamo) {
    const c = toChoseong(n);
    if (c.startsWith(q)) return 3;
    if (c.includes(q)) return 4;
  }
  return null;
}

/** 입력과 맞는 항목을 가까운 순서로 돌려준다(앞부분 일치 → 포함 → 초성). */
export function suggestSkills(options: readonly SkillOption[], rawName: string, limit = 8): SkillOption[] {
  const q = normalizeName(rawName);
  if (!q || looksLikeDice(rawName)) return [];
  const qJamo = /^[ㄱ-ㅎ]+$/.test(q);
  return options
    .map((o, i) => ({ o, s: score(o, q, qJamo), i }))
    .filter((x): x is { o: SkillOption; s: number; i: number } => x.s !== null)
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.o);
}

/** 이름이 정확히 같은 항목(띄어쓰기·대소문자 무시). 없으면 null. */
export function resolveSkill(options: readonly SkillOption[], rawName: string): SkillOption | null {
  const q = normalizeName(rawName);
  if (!q) return null;
  return options.find((o) => normalizeName(o.name) === q) ?? null;
}

/** 고른 항목을 입력칸에 채울 글. 난이도·보너스를 이미 적어 뒀다면 그대로 이어 붙인다. */
export function completeText(raw: string, opt: SkillOption): string {
  const q = parseSkillQuery(raw);
  const tail = [q?.difficulty ? { regular: "보통", hard: "어려움", extreme: "극단" }[q.difficulty] : "", q && q.bonus ? (q.bonus > 0 ? `+${q.bonus}` : String(q.bonus)) : ""].filter(Boolean).join(" ");
  return tail ? `${opt.name} ${tail}` : opt.name;
}
