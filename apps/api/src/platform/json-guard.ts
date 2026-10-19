/**
 * JSON 글을 파싱하기 전에 모양만 훑어 보는 값싼 점검. 글자 안(따옴표 속)은 건너뛰고,
 * 괄호 깊이와 구조 기호({ [ ,) 수만 센다. 이상하게 깊거나 항목이 어마어마한 글(수백만 개의 0 같은)을
 * JSON.parse·검증에 넘기기 전에 거절하려는 용도다. 진짜 시나리오·백업은 이 한도의 몇 분의 일도 안 쓴다.
 */
export interface JsonGuardLimits {
  maxDepth: number;
  /** { [ , 를 합친 구조 기호 수 */
  maxTokens: number;
}

export const SCENARIO_JSON_LIMITS: JsonGuardLimits = { maxDepth: 24, maxTokens: 300_000 };

export type JsonGuardResult = { ok: true } | { ok: false; reason: "not_object" | "too_deep" | "too_many" };

export function guardJson(buf: Buffer, limits: JsonGuardLimits = SCENARIO_JSON_LIMITS): JsonGuardResult {
  let i = 0;
  const n = buf.length;
  // 맨 앞 BOM·공백을 건너뛴다. 맨 바깥은 { } 항목이어야 한다.
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) i = 3;
  while (i < n && (buf[i] === 0x20 || buf[i] === 0x0a || buf[i] === 0x0d || buf[i] === 0x09)) i++;
  if (buf[i] !== 0x7b) return { ok: false, reason: "not_object" };
  let depth = 0;
  let tokens = 0;
  for (; i < n; i++) {
    const c = buf[i]!;
    if (c === 0x22) {
      // 따옴표 안은 통째로 건너뛴다(\" 처럼 이스케이프된 따옴표는 닫는 따옴표가 아니다).
      for (i++; i < n; i++) {
        const d = buf[i]!;
        if (d === 0x5c) i++;
        else if (d === 0x22) break;
      }
    } else if (c === 0x7b || c === 0x5b) {
      depth++;
      tokens++;
      if (depth > limits.maxDepth) return { ok: false, reason: "too_deep" };
    } else if (c === 0x7d || c === 0x5d) {
      depth--;
    } else if (c === 0x2c) {
      tokens++;
    }
    if (tokens > limits.maxTokens) return { ok: false, reason: "too_many" };
  }
  return { ok: true };
}
