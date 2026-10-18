import { describe, expect, it } from "vitest";
import {
  FULL,
  H,
  MAX_ZOOM,
  W,
  centerOn,
  clampView,
  formatDistance,
  hitRadius,
  isFit,
  labelUnits,
  panBy,
  parseView,
  pinchView,
  pxPerUnit,
  rulerDistance,
  screenToBoard,
  serializeView,
  snapCorner,
  snapPoint,
  tokenScale,
  viewKey,
  wheelFactor,
  zoomAt,
  zoomCenter,
  type Frame,
} from "./view";

// 보드와 같은 비율(5:4)의 화면 틀: 1 보드 단위 = 0.5px
const F: Frame = { left: 100, top: 50, width: 500, height: 400 };
// 가로로 긴 틀(위아래가 꽉 차고 좌우가 남는다)
const WIDE: Frame = { left: 0, top: 0, width: 1000, height: 400 };

describe("보기 가두기", () => {
  it("폭은 [W/MAX, W] 안으로, 위치는 보드 안으로 가둔다", () => {
    expect(clampView({ x: -50, y: -50, w: 5000 })).toEqual({ x: 0, y: 0, w: W, h: H });
    const z = clampView({ x: 900, y: 900, w: 1 });
    expect(z.w).toBeCloseTo(W / MAX_ZOOM);
    expect(z.x + z.w).toBeLessThanOrEqual(W + 1e-9);
    expect(z.y + z.h).toBeLessThanOrEqual(H + 1e-9);
    expect(z.h / z.w).toBeCloseTo(H / W);
  });
});

describe("좌표 변환", () => {
  it("틀 안의 화면 좌표를 보드 좌표로 바꾼다", () => {
    expect(pxPerUnit(FULL, F)).toBeCloseTo(0.5);
    expect(screenToBoard(FULL, F, 100, 50)).toEqual({ x: 0, y: 0 });
    expect(screenToBoard(FULL, F, 350, 250)).toEqual({ x: 500, y: 400 });
  });
  it("레터박스(보드 밖) 좌표는 보드 안으로 가둔다", () => {
    // WIDE: 보드가 가운데 500px 폭으로 그려진다
    expect(pxPerUnit(FULL, WIDE)).toBeCloseTo(0.5);
    expect(screenToBoard(FULL, WIDE, 0, 200).x).toBe(0);
    expect(screenToBoard(FULL, WIDE, 500, 200).x).toBeCloseTo(500);
    expect(screenToBoard(FULL, WIDE, 990, 200).x).toBe(W);
  });
});

describe("확대·축소(커서 기준)", () => {
  it("커서 아래의 보드 점이 확대 뒤에도 같은 자리에 있다", () => {
    const cx = 250;
    const cy = 150;
    const before = screenToBoard(FULL, F, cx, cy);
    const next = zoomAt(FULL, F, 2, cx, cy);
    expect(next.w).toBeCloseTo(W / 2);
    const after = screenToBoard(next, F, cx, cy);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
  });
  it("모서리에서 확대하면 보드 밖을 보여 주지 않는다", () => {
    const next = zoomAt(FULL, F, 4, 100, 50);
    expect(next.x).toBe(0);
    expect(next.y).toBe(0);
  });
  it("너무 많이 확대·축소해도 한계에서 멈추고, 축소하면 맞춤으로 돌아온다", () => {
    let v = FULL;
    for (let i = 0; i < 20; i++) v = zoomCenter(v, F, 2);
    expect(v.w).toBeCloseTo(W / MAX_ZOOM);
    for (let i = 0; i < 20; i++) v = zoomCenter(v, F, 0.5);
    expect(isFit(v)).toBe(true);
    expect(v).toEqual(FULL);
  });
  it("휠 방향: 위로 굴리면 확대, 아래로 굴리면 축소", () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeLessThan(1);
    expect(wheelFactor(-100)).toBeCloseTo(1 / wheelFactor(100));
    expect(wheelFactor(-100, 0, true)).toBeGreaterThan(wheelFactor(-100));
    expect(wheelFactor(-100000)).toBeLessThan(10); // 한 번에 너무 커지지 않는다
  });
});

describe("끌어서 이동", () => {
  it("끈 만큼 반대 방향으로 보기가 움직이고 보드 밖으로는 못 나간다", () => {
    const z = zoomCenter(FULL, F, 2); // 폭 500, 1단위=1px
    const p = panBy(z, F, 100, 0); // 오른쪽으로 100px 끌기 → 보기는 왼쪽으로 100단위
    expect(p.x).toBeCloseTo(z.x - 100);
    expect(panBy(z, F, 99999, 99999)).toMatchObject({ x: 0, y: 0 });
    expect(panBy(z, F, -99999, -99999).x).toBeCloseTo(W - z.w);
  });
  it("맞춤 상태에서는 끌어도 움직이지 않는다", () => {
    expect(panBy(FULL, F, 80, 30)).toEqual(FULL);
  });
});

describe("두 손가락 확대(핀치)", () => {
  const P: [{ x: number; y: number }, { x: number; y: number }] = [
    { x: 200, y: 150 },
    { x: 300, y: 150 },
  ];
  it("벌리면 확대되고 두 손가락 가운데 아래의 점이 그 자리를 지킨다", () => {
    const start = zoomCenter(FULL, F, 1.5);
    const q: typeof P = [
      { x: 150, y: 150 },
      { x: 350, y: 150 },
    ]; // 거리 2배, 가운데 그대로
    const next = pinchView(start, F, P, q);
    expect(next.w).toBeCloseTo(start.w / 2);
    const b0 = screenToBoard(start, F, 250, 150);
    const b1 = screenToBoard(next, F, 250, 150);
    expect(b1.x).toBeCloseTo(b0.x, 5);
    expect(b1.y).toBeCloseTo(b0.y, 5);
  });
  it("모으면 축소되어 맞춤을 넘지 않는다", () => {
    const start = zoomCenter(FULL, F, 2);
    const q: typeof P = [
      { x: 245, y: 150 },
      { x: 255, y: 150 },
    ];
    expect(pinchView(start, F, P, q)).toEqual(FULL);
  });
  it("두 손가락을 함께 옮기면 배율은 그대로 이동한다", () => {
    const start = zoomCenter(FULL, F, 2);
    const q: typeof P = [
      { x: 250, y: 150 },
      { x: 350, y: 150 },
    ]; // 오른쪽으로 50px
    const next = pinchView(start, F, P, q);
    expect(next.w).toBeCloseTo(start.w);
    expect(next.x).toBeCloseTo(start.x - 50 / pxPerUnit(start, F));
  });
  it("두 점이 거의 겹치면 보기를 바꾸지 않는다", () => {
    const same: [{ x: number; y: number }, { x: number; y: number }] = [{ x: 10, y: 10 }, { x: 10, y: 10 }];
    expect(pinchView(FULL, F, same, P)).toEqual(FULL);
  });
});

describe("내 토큰으로 가기", () => {
  it("점이 보기 가운데에 오고, 배율을 주면 그 배율이 된다", () => {
    const v = centerOn(zoomCenter(FULL, F, 2), { x: 700, y: 300 });
    expect(v.x + v.w / 2).toBeCloseTo(700);
    expect(v.y + v.h / 2).toBeCloseTo(300);
    const z = centerOn(FULL, { x: 500, y: 400 }, 2);
    expect(z.w).toBeCloseTo(W / 2);
  });
  it("모서리의 점은 가운데로 못 오고 보드 안에 머문다", () => {
    const v = centerOn(FULL, { x: 5, y: 5 }, 2);
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
  });
});

describe("격자 맞추기", () => {
  it("칸 중앙으로 맞춘다", () => {
    expect(snapPoint({ x: 0, y: 0 }, 40)).toEqual({ x: 20, y: 20 });
    expect(snapPoint({ x: 39, y: 41 }, 40)).toEqual({ x: 20, y: 60 });
    expect(snapPoint({ x: 707, y: 309 }, 40)).toEqual({ x: 700, y: 300 });
  });
  it("보드 끝에서도 마지막 칸 안에 머문다", () => {
    expect(snapPoint({ x: W, y: H }, 40)).toEqual({ x: 980, y: 780 });
    // 칸이 보드에 딱 나누어떨어지지 않아도 보드 밖으로 나가지 않는다
    const p = snapPoint({ x: W, y: H }, 150);
    expect(p.x).toBeLessThanOrEqual(W);
    expect(p.y).toBeLessThanOrEqual(H);
  });
  it("이미 칸 중앙인 점은 그대로이고(멱등), 크기가 이상하면 건드리지 않는다", () => {
    const p = snapPoint({ x: 333, y: 222 }, 50);
    expect(snapPoint(p, 50)).toEqual(p);
    expect(snapPoint({ x: 3, y: 4 }, 0)).toEqual({ x: 3, y: 4 });
  });
  it("모서리로 맞추기", () => {
    expect(snapCorner({ x: 59, y: 61 }, 40)).toEqual({ x: 40, y: 80 });
    expect(snapCorner({ x: 5000, y: -3 }, 40)).toEqual({ x: W, y: 0 });
  });
});

describe("자(거리)", () => {
  it("칸 수와 보드 단위를 함께 낸다", () => {
    const r = rulerDistance({ x: 0, y: 0 }, { x: 120, y: 160 }, 40);
    expect(r.units).toBeCloseTo(200);
    expect(r.cells).toBeCloseTo(5);
    expect(rulerDistance({ x: 0, y: 0 }, { x: 80, y: 0 }, 0).cells).toBeCloseTo(2); // 칸 크기가 이상하면 기본 40
  });
  it("글자는 칸 수를 소수 첫째 자리까지, 정수면 소수점 없이 보여 준다", () => {
    expect(formatDistance({ x: 0, y: 0 }, { x: 120, y: 160 }, 40)).toBe("5칸 (200)");
    expect(formatDistance({ x: 0, y: 0 }, { x: 100, y: 0 }, 40)).toBe("2.5칸 (100)");
    expect(formatDistance({ x: 0, y: 0 }, { x: 100, y: 0 }, 50)).toBe("2칸 (100)");
  });
});

describe("축소해도 읽히는 크기", () => {
  it("보통 크기에서는 기본값 그대로, 많이 축소하면 화면 11.5px을 지킨다", () => {
    expect(labelUnits(12, 1)).toBe(12);
    expect(labelUnits(12, 0.39) * 0.39).toBeGreaterThanOrEqual(11.4);
    expect(labelUnits(12, 0.01)).toBe(36); // 끝없이 커지지 않는다
  });
  it("토큰 몸통은 작은 화면에서만 커지고 상한이 있다", () => {
    expect(tokenScale(48, 1)).toBe(1);
    expect(tokenScale(48, 0.39) * 48 * 0.39).toBeGreaterThanOrEqual(33.9);
    expect(tokenScale(48, 0.05)).toBe(2.5);
  });
  it("눌림 판정은 화면에서 지름 44px 이상", () => {
    expect(hitRadius(44, 1)).toBe(44);
    expect(hitRadius(44, 0.39) * 2 * 0.39).toBeGreaterThanOrEqual(43.9);
  });
});

describe("보관", () => {
  it("보기를 저장했다 읽으면 같은 보기이고, 장면마다 키가 다르다", () => {
    const v = zoomAt(FULL, F, 2.5, 200, 120);
    const back = parseView(serializeView(v))!;
    expect(back.w).toBeCloseTo(v.w, 0);
    expect(back.x).toBeCloseTo(v.x, 0);
    expect(viewKey("u", "r", "s1")).not.toBe(viewKey("u", "r", "s2"));
    expect(viewKey("a", "r", "s")).not.toBe(viewKey("b", "r", "s"));
  });
  it("깨진 값은 무시하고, 범위를 벗어난 값은 가둔다", () => {
    expect(parseView(null)).toBeNull();
    expect(parseView("{")).toBeNull();
    expect(parseView('{"x":"a","y":1,"w":2}')).toBeNull();
    expect(parseView('{"x":5000,"y":5000,"w":10}')).toMatchObject({ w: W / MAX_ZOOM });
  });
});
