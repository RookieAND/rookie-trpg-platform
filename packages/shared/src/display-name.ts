/**
 * 접속자 표시 이름 정리. 이름은 로그인 정보(디스코드 별명 등)에서 오고 사용자가 마음대로 바꿀 수 있어서,
 * 서버가 받는 자리마다 이 함수를 거친다.
 *  - 제어 문자(줄바꿈 포함), 서식 문자(제로폭 문자, 방향 조작 문자 LRO·RLO 등)를 지운다.
 *  - 모든 공백은 한 칸으로 줄이고 앞뒤를 자른다.
 *  - 결합 문자(위아래로 쌓이는 장식)는 연달아 3개까지만 둔다.
 *  - 글자 수(코드포인트) 상한을 지킨다.
 * 비면 fallback을 돌려준다.
 */
export const DISPLAY_NAME_MAX = 40;
export const DISPLAY_NAME_FALLBACK = "이름 없음";

// 제어(Cc)·서식(Cf: 제로폭, 방향 표시·덮어쓰기·고립 포함)·줄/문단 구분(Zl, Zp)·대체 문자(Cs)·미지정(Cn)
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}\p{Cn}￼�]/gu;
const SPACES = /[\s\p{Zs}]+/gu;
const MARK_RUN = /(\p{M}{3})\p{M}+/gu;

export function sanitizeDisplayName(raw: unknown, fallback: string = DISPLAY_NAME_FALLBACK, max: number = DISPLAY_NAME_MAX): string {
  if (typeof raw !== "string") return fallback;
  const cleaned = raw.normalize("NFC").replace(INVISIBLE, "").replace(SPACES, " ").replace(MARK_RUN, "$1").trim();
  const capped = Array.from(cleaned).slice(0, max).join("").trim();
  return capped || fallback;
}

/** GM으로 착각하게 만드는 이름(공백·기호를 빼고 비교). PL·관전자가 쓰면 구분 표시를 붙인다. */
const RESERVED = new Set(["gm", "kp", "gamemaster", "keeper", "지엠", "게임마스터", "케이피", "키퍼", "운영자", "관리자", "시스템", "system", "admin"]);
const squash = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}_]+/gu, "");

export const isReservedDisplayName = (name: string): boolean => RESERVED.has(squash(name));

/** GM이 아닌 사람이 GM 같은 이름을 쓰면 "(참가자)"를 붙여 화면에서 구분되게 한다. */
export function memberDisplayName(raw: unknown, isGm: boolean): string {
  const name = sanitizeDisplayName(raw);
  if (isGm || !isReservedDisplayName(name)) return name;
  return `${Array.from(name).slice(0, DISPLAY_NAME_MAX - 6).join("")} (참가자)`;
}
