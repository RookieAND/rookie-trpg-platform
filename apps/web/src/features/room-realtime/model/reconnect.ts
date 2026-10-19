/** 다시 붙어도 소용없는 거절 코드: 인증 실패, 접근 거절, 없는 룸, 정원 초과, GM이 내보냄(4410) 등. 4408은 일시적이라 제외한다. */
export const isFinalClose = (code: number) => code >= 4401 && code <= 4410 && code !== 4408;

/** 연결이 닫힌 뒤 할 일. */
export type CloseAction = "stop" | "retry" | "refresh";

/**
 * 닫힌 코드와 상황으로 다음 행동을 정한다.
 * - 로그인 토큰으로 접속했다가 4401을 받으면 한 번은 토큰을 갱신해 다시 붙는다(`refresh`).
 * - 갱신했는데도 4401이거나 갱신 수단이 없으면 `stop`(다시 로그인 안내).
 */
export function nextAfterClose(o: { code: number; stopped: boolean; hasToken: boolean; canRefresh: boolean; alreadyRefreshed: boolean }): CloseAction {
  if (o.stopped) return "stop";
  if (o.code === 4401 && o.hasToken && o.canRefresh && !o.alreadyRefreshed) return "refresh";
  return isFinalClose(o.code) ? "stop" : "retry";
}

/** n번째 재시도까지 기다릴 시간(ms). 0.5초에서 시작해 두 배씩, 최대 10초. */
export const backoffMs = (attempt: number) => Math.min(10_000, 500 * 2 ** attempt);
