/** 입력 확인 창에서 돌려줄 값. 앞뒤 공백을 떼고, 비었거나 처음 값과 같으면 null(바꾸지 않음). */
export function promptResult(raw: string, initial: string): string | null {
  const v = raw.trim();
  return v && v !== initial.trim() ? v : null;
}
