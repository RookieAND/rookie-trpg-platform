/** 보드 위의 점이 어느 오브젝트 위인지 가린다. 겹쳐 있으면 위에 그려진 것(목록 뒤쪽)이 이긴다. */
export interface HitObject {
  id: string;
  kind: "token" | "prop";
  image?: string | undefined;
  x: number;
  y: number;
}

/** 토큰 반지름(그림 24 + 여유) */
export const TOKEN_HIT = 30;
/** 소품 반 너비·반 높이(그림 있으면 64×64, 없으면 72×28 상자 + 여유) */
const PROP_HALF_W = 36;
const propHalfH = (o: HitObject) => (o.image ? 36 : 18);

export function objectAt(objects: ReadonlyArray<HitObject>, x: number, y: number): string | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i]!;
    const hit = o.kind === "token" ? Math.hypot(o.x - x, o.y - y) <= TOKEN_HIT : Math.abs(o.x - x) <= PROP_HALF_W && Math.abs(o.y - y) <= propHalfH(o);
    if (hit) return o.id;
  }
  return null;
}
