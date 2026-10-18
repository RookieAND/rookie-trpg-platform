/** 수치 칸에 적은 글을 시트 변경으로 바꾼다. `12`는 그 값으로, `+3`·`-7`은 그만큼 더하고 뺀다. 범위(0~최대)를 넘지 않게 맞춘다. */
export type StatEdit = { delta: number } | { value: number };

export function parseStatInput(raw: string, current: number, max: number): StatEdit | null {
  const text = raw.trim().replace(/[−–—﹣－]/g, "-").replace(/＋/g, "+").replace(/\s+/g, "");
  if (!/^[+-]?\d{1,4}$/.test(text)) return null;
  const n = Number(text);
  const relative = text.startsWith("+") || text.startsWith("-");
  const target = Math.min(max, Math.max(0, relative ? current + n : n));
  if (target === current) return null;
  // 상대 입력은 서버의 delta로 보낸다(동시에 다른 변경이 있어도 그 위에 더해진다).
  return relative ? { delta: target - current } : { value: target };
}

/** 빠른 조정 버튼이 보낼 변화량. 범위 밖이면 가능한 만큼만, 이미 끝이면 null */
export function stepDelta(step: number, current: number, max: number): number | null {
  const d = Math.min(max, Math.max(0, current + step)) - current;
  return d === 0 ? null : d;
}
