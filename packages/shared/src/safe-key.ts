import { z } from "zod";

/**
 * 사용자가 적은 글자를 객체의 키(기능 이름 등)로 쓸 때의 안전 장치.
 * `__proto__`·`constructor`·`prototype`은 객체의 원형을 건드릴 수 있고, 나머지는 Object.prototype에서 상속된 함수 이름이라
 * `obj[name]`이 "있는 값"처럼 보인다. 이런 이름은 어디서도 받지 않는다.
 */
export const UNSAFE_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toString",
  "toLocaleString",
  "valueOf",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
]);

export const UNSAFE_KEY_MESSAGE = "사용할 수 없는 이름이에요. 다른 이름으로 적어 주세요.";

/** 키로 써도 되는 이름인가. 앞뒤 공백을 떼고 비교한다. */
export const isSafeKey = (name: string): boolean => !UNSAFE_KEYS.has(name.trim());

/** 키 이름 규칙을 더한 zod 문자열(기능 이름 등). 기존 길이 규칙 위에 얹는다. */
export const safeKey = <T extends z.ZodString>(s: T) => s.refine(isSafeKey, { message: UNSAFE_KEY_MESSAGE });

/** 객체 자신이 가진 키만 읽는다(상속된 것은 없는 것으로 본다). */
export const own = <T>(o: Readonly<Record<string, T>> | undefined, key: string): T | undefined => (o && Object.hasOwn(o, key) ? o[key] : undefined);

/** 자기 키만, 안전한 이름만 남긴 새 객체(저장된 옛 데이터나 바깥에서 온 JSON을 받을 때). */
export function ownSafeEntries<T>(o: Readonly<Record<string, T>> | undefined): Array<[string, T]> {
  return Object.entries(o ?? {}).filter(([k]) => isSafeKey(k));
}
