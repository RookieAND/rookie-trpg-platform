/** 이보다 오래된 이벤트는 재접속 때 다시 받은 것이라 연출·소리를 내지 않는다. 시계가 크게 어긋난 기기(5분 이상)는 이 검사를 건너뛴다. */
const STALE_MS = 8000;
const SKEW_MS = 5 * 60_000;

/** at(서버 시각)이 now(보정한 내 시각)보다 한참 전이면 true */
export function isStaleEvent(at: number, now: number): boolean {
  const age = now - at;
  return age > STALE_MS && age < SKEW_MS;
}
