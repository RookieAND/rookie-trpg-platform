/** 같은 이름이 이미 있으면 "이름 2", "이름 3"처럼 붙여 겹치지 않게 한다(40자 제한 안에서). */
export function uniqueName(base: string, taken: ReadonlyArray<string>): string {
  const set = new Set(taken);
  const root = base.trim().slice(0, 36) || "토큰";
  if (!set.has(root)) return root;
  for (let i = 2; i < 1000; i++) {
    const n = `${root} ${i}`;
    if (!set.has(n)) return n;
  }
  return root;
}
