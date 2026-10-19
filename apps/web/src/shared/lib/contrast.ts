/** WCAG 대비 계산. 색은 #rgb/#rrggbb 또는 rgba(r,g,b,a)이고, 투명한 색은 깔린 색 위에 올려 섞는다. */
export type Rgb = [number, number, number];

export function parseColor(text: string): { rgb: Rgb; alpha: number } {
  const t = text.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(t);
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((c) => c + c).join("") : hex[1]!;
    return { rgb: [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb, alpha: 1 };
  }
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(t);
  if (m) return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], alpha: m[4] === undefined ? 1 : Number(m[4]) };
  throw new Error(`읽을 수 없는 색: ${text}`);
}

/** fg(투명도 포함)를 bg 위에 올린 색 */
export function over(fg: string, bg: Rgb): Rgb {
  const { rgb, alpha } = parseColor(fg);
  return rgb.map((c, i) => c * alpha + bg[i]! * (1 - alpha)) as Rgb;
}

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
export const luminance = ([r, g, b]: Rgb) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

export function contrast(a: Rgb, b: Rgb): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** CSS 글에서 `:root { ... }` 안의 --이름: 값 을 모은다. */
export function rootTokens(css: string): Record<string, string> {
  const block = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}
