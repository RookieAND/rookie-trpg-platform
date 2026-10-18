import { dedupeMarkers, isMarkerKey, markerLabel, splitMarkers, MARKER_DEF, type Marker, type MarkerShape } from "@coc-vtt/shared";

/** 토큰 한 칸(반지름 R)을 기준으로 배지를 놓는 자리. 왼쪽 위(부상 칩)와 오른쪽 위("나" 배지)는 피한다. */
export const BADGE_R = 8;

export interface BadgeSpec {
  key: string;
  label: string;
  /** 스크린 리더가 읽는 글 */
  aria: string;
  shape: MarkerShape;
  color: string;
  glyph: string;
  secret: boolean;
  /** 토큰 중심에서 얼마나 떨어졌는지 */
  dx: number;
  dy: number;
}

export interface BadgeLayout {
  badges: BadgeSpec[];
  /** 넘친 표식 수(+n 배지). 0이면 없다. */
  more: number;
  moreAria: string;
  moreAt: { dx: number; dy: number };
}

/** 한 토큰의 표식을 그릴 배지와 자리. 시트의 부상 칩과 같은 뜻(기절·사망)은 겹쳐 그리지 않는다. */
export function layoutBadges(markers: readonly Marker[] | undefined, wound: readonly string[] | undefined, tokenRadius: number): BadgeLayout {
  const list = dedupeMarkers(markers ?? [], wound);
  const { shown, more } = splitMarkers(list);
  const r = tokenRadius;
  const slots = [
    { dx: r + 9, dy: 0 },
    { dx: -(r + 9), dy: 0 },
    { dx: r + 7, dy: 18 },
    { dx: -(r + 7), dy: 18 },
  ];
  const badges = shown.map((m, i): BadgeSpec => {
    const def = isMarkerKey(m.key) ? MARKER_DEF[m.key] : undefined;
    const label = markerLabel(m);
    return {
      key: m.key,
      label,
      aria: `상태 ${label}${m.secret ? ", GM만 보임" : ""}`,
      shape: def?.shape ?? "circle",
      color: def?.color ?? "#b4b7bf",
      glyph: def?.glyph ?? "·",
      secret: m.secret === true,
      ...slots[i]!,
    };
  });
  const hiddenLabels = list.slice(shown.length).map(markerLabel);
  return { badges, more, moreAria: more > 0 ? `표식 ${more}개 더 있음: ${hiddenLabels.join(", ")}` : "", moreAt: { dx: 4, dy: -(r + 10) } };
}

/** 배지 모양의 SVG 경로(중심 0,0, 반지름 r). circle·square·pill은 경로가 아니라 기본 도형으로 그려서 null이다. */
export function shapePath(shape: MarkerShape, r: number): string | null {
  const f = (v: number) => +v.toFixed(2);
  const poly = (pts: Array<[number, number]>) => `M${pts.map(([x, y]) => `${f(x)},${f(y)}`).join("L")}Z`;
  const ngon = (n: number, rot: number, k: number) => poly(Array.from({ length: n }, (_, i) => [Math.cos(rot + (i * 2 * Math.PI) / n) * r * k, Math.sin(rot + (i * 2 * Math.PI) / n) * r * k]));
  switch (shape) {
    case "diamond":
      return poly([[0, -r * 1.25], [r * 1.1, 0], [0, r * 1.25], [-r * 1.1, 0]]);
    case "triangle":
      return poly([[0, -r * 1.2], [r * 1.2, r * 0.95], [-r * 1.2, r * 0.95]]);
    case "hexagon":
      return ngon(6, Math.PI / 6, 1.1);
    case "octagon":
      return ngon(8, Math.PI / 8, 1.1);
    case "shield":
      return poly([[-r, -r * 0.9], [r, -r * 0.9], [r, r * 0.2], [0, r * 1.2], [-r, r * 0.2]]);
    case "flag":
      // 묘비: 위가 둥근 모양
      return `M${f(-r)},${f(r)}L${f(-r)},${f(-r * 0.1)}A${f(r)},${f(r * 1.1)} 0 0 1 ${f(r)},${f(-r * 0.1)}L${f(r)},${f(r)}Z`;
    case "star": {
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const k = i % 2 === 0 ? 1.3 : 0.55;
        pts.push([Math.cos(a) * r * k, Math.sin(a) * r * k]);
      }
      return poly(pts);
    }
    default:
      return null;
  }
}
