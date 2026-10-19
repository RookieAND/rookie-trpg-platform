/** 토큰 이름표: 길면 줄이고, 겹치면 아래로 비키고, 그래도 겹치면 숨긴다. */

export const LABEL_MAX_CHARS = 14;

/** 14자를 넘으면 …로 줄인다. 전체 이름은 호출하는 쪽에서 툴팁·aria 로 따로 둔다. */
export function truncateLabel(name: string, max = LABEL_MAX_CHARS): string {
  const chars = Array.from(name);
  return chars.length <= max ? name : `${chars.slice(0, max - 1).join("")}…`;
}

/** 글자 폭 어림: 한글·전각은 1em, 그 밖은 0.6em */
export function textWidth(text: string, fs: number): number {
  let w = 0;
  for (const ch of text) w += /[ᄀ-ᇿ㄰-㆏가-힯　-鿿＀-￯]/.test(ch) ? fs : fs * 0.6;
  return w;
}

export interface LabelIn {
  id: string;
  x: number;
  y: number;
  text: string;
  /** 고른 토큰의 이름표는 늘 보인다 */
  keep?: boolean;
}
export interface LabelOut {
  id: string;
  y: number;
  hidden: boolean;
}

interface Box {
  l: number;
  r: number;
  t: number;
  b: number;
}
const hit = (a: Box, b: Box) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

/**
 * 이름표 자리를 정한다. 고른 것·늘 보여야 하는 것을 먼저 놓고, 나머지는 겹치면 한 줄씩(최대 2번) 아래로 비킨다.
 * 비켜도 겹치면 숨긴다. y 는 글자 바닥선이다.
 */
export function layoutLabels(labels: LabelIn[], fs: number): Map<string, LabelOut> {
  const out = new Map<string, LabelOut>();
  const placed: Box[] = [];
  const box = (l: LabelIn, y: number): Box => {
    const w = textWidth(l.text, fs);
    return { l: l.x - w / 2, r: l.x + w / 2, t: y - fs, b: y + fs * 0.25 };
  };
  const order = [...labels].sort((a, b) => Number(Boolean(b.keep)) - Number(Boolean(a.keep)) || a.y - b.y || a.x - b.x);
  for (const l of order) {
    let y = l.y;
    let ok = false;
    for (let i = 0; i < 3; i++, y += fs * 1.15) {
      const bx = box(l, y);
      if (!placed.some((p) => hit(p, bx))) {
        placed.push(bx);
        ok = true;
        break;
      }
    }
    if (ok) out.set(l.id, { id: l.id, y, hidden: false });
    else if (l.keep) {
      placed.push(box(l, l.y));
      out.set(l.id, { id: l.id, y: l.y, hidden: false });
    } else out.set(l.id, { id: l.id, y: l.y, hidden: true });
  }
  return out;
}
