import { CHAT_MAX_LENGTH } from "./protocol";
import { MARKER_TEXT_MAX } from "./markers";
import { MAX_MACRO_NAME } from "./library";

/**
 * 입력 칸의 글자 수 한도. 서버 규격(protocol.ts의 zod)과 같은 값이며, limits.test.ts가 둘이 어긋나면 실패하게 지킨다.
 * 화면은 이 값을 maxLength와 안내 문구에 그대로 쓴다(숫자를 따로 적지 않는다).
 */
export const LIMITS = {
  roomName: 60,
  sceneName: 40,
  objectName: 40,
  handoutTitle: 60,
  handoutBody: 4000,
  characterName: 40,
  occupation: 40,
  skillName: 30,
  weaponName: 30,
  weaponDamage: 40,
  notes: 2000,
  backstory: 2000,
  possessions: 1000,
  initiativeName: 30,
  rollName: 30,
  chat: CHAT_MAX_LENGTH,
  markerText: MARKER_TEXT_MAX,
  macroName: MAX_MACRO_NAME,
} as const;

export type LimitKey = keyof typeof LIMITS;
