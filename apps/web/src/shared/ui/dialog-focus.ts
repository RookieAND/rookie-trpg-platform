/** Tab을 눌렀을 때 대화상자 안에서 다음에 갈 칸. 안에서 자연스럽게 움직이면 null(브라우저에 맡김). */
export function trapTarget(count: number, current: number, shift: boolean): number | null {
  if (count === 0) return -1; // 갈 곳이 없으면 대화상자 자체에 둔다
  if (current < 0) return shift ? count - 1 : 0; // 대화상자 밖이나 자체에 있으면 안으로 들인다
  if (!shift && current === count - 1) return 0;
  if (shift && current === 0) return count - 1;
  return null;
}

/** 여러 대화상자가 겹치면 맨 위 하나만 Esc·Tab에 반응한다. */
export function isTop<T>(stack: T[], item: T): boolean {
  return stack.at(-1) === item;
}
