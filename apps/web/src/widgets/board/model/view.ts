/**
 * 보드 보기(확대·이동)와 격자·자 계산. 모두 화면에서만 쓰는 변환이라 서버 좌표는 바뀌지 않는다.
 * 보드는 W×H 보드 단위이고, 보기는 그중 보이는 직사각형(viewBox)이다. 보기의 가로세로 비는 보드와 같다.
 */
export const W = 1000;
export const H = 800;
/** 가장 많이 확대했을 때 보기 폭은 W / MAX_ZOOM */
export const MAX_ZOOM = 6;
/** 격자 한 칸의 기본 보드 단위(격자를 정하지 않은 장면의 거리 표시에 쓴다) */
export const DEFAULT_CELL = 40;

export interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** 보드를 그리는 요소의 화면 위치와 크기(px) */
export interface Frame {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface Pt {
  x: number;
  y: number;
}

export const FULL: View = { x: 0, y: 0, w: W, h: H };

/** 보기 폭 w로 만든 보기(높이는 비율대로). 폭은 [W/MAX_ZOOM, W] 안으로 가두고, 보드 밖으로 나가지 않게 옮긴다. */
export function clampView(v: { x: number; y: number; w: number }): View {
  const w = Math.min(W, Math.max(W / MAX_ZOOM, v.w));
  const h = (w * H) / W;
  return { w, h, x: Math.max(0, Math.min(W - w, v.x)), y: Math.max(0, Math.min(H - h, v.y)) };
}

/** 화면 1px이 보드 몇 단위인지의 역수: 보드 1단위가 화면 몇 px로 그려지는지(preserveAspectRatio=meet) */
export function pxPerUnit(v: View, f: Pick<Frame, "width" | "height">): number {
  if (f.width <= 0 || f.height <= 0) return 1;
  return Math.min(f.width / v.w, f.height / v.h);
}

/** 화면 좌표(clientX/Y) → 보드 좌표. 보드 바깥(레터박스)은 보드 안으로 가둔다. */
export function screenToBoard(v: View, f: Frame, cx: number, cy: number): Pt {
  const s = pxPerUnit(v, f);
  const offX = (f.width - v.w * s) / 2;
  const offY = (f.height - v.h * s) / 2;
  return { x: clamp(v.x + (cx - f.left - offX) / s, 0, W), y: clamp(v.y + (cy - f.top - offY) / s, 0, H) };
}

/** 폭이 w인 보기에서, 보드의 점 b가 화면의 (cx, cy)에 오도록 맞춘 보기 */
export function viewAnchored(w: number, b: Pt, f: Frame, cx: number, cy: number): View {
  const probe = clampView({ x: 0, y: 0, w });
  const s = pxPerUnit(probe, f);
  const offX = (f.width - probe.w * s) / 2;
  const offY = (f.height - probe.h * s) / 2;
  return clampView({ w: probe.w, x: b.x - (cx - f.left - offX) / s, y: b.y - (cy - f.top - offY) / s });
}

/** 커서(cx, cy) 아래의 보드 점이 그대로 있도록 factor배 확대(>1)·축소(<1) */
export function zoomAt(v: View, f: Frame, factor: number, cx: number, cy: number): View {
  const b = screenToBoard(v, f, cx, cy);
  return viewAnchored(v.w / factor, b, f, cx, cy);
}

/** 화면 중앙을 기준으로 확대·축소 */
export function zoomCenter(v: View, f: Frame, factor: number): View {
  return zoomAt(v, f, factor, f.left + f.width / 2, f.top + f.height / 2);
}

/** 화면에서 (dx, dy)px 끌었을 때의 보기 */
export function panBy(v: View, f: Pick<Frame, "width" | "height">, dx: number, dy: number): View {
  const s = pxPerUnit(v, f);
  return clampView({ w: v.w, x: v.x - dx / s, y: v.y - dy / s });
}

/** 보드의 한 점이 보기 가운데에 오도록 옮긴 보기. zoom을 주면 그 배율(1=맞춤)로 맞춘다. */
export function centerOn(v: View, p: Pt, zoom?: number): View {
  const w = zoom ? W / zoom : v.w;
  const cw = Math.min(W, Math.max(W / MAX_ZOOM, w));
  return clampView({ w: cw, x: p.x - cw / 2, y: p.y - (cw * H) / W / 2 });
}

/** 지금 배율(1이 맞춤) */
export const zoomLevel = (v: View) => W / v.w;
export const isFit = (v: View) => v.w >= W - 0.5;

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/**
 * 두 손가락 모아 벌리기. 시작할 때의 보기(start)와 두 점(p), 지금의 두 점(q)으로 지금의 보기를 구한다.
 * 시작할 때 두 손가락 가운데 아래에 있던 보드 점이 지금 두 손가락 가운데 아래에 오고, 거리 비율만큼 배율이 바뀐다.
 */
export function pinchView(start: View, f: Frame, p: [Pt, Pt], q: [Pt, Pt]): View {
  const d0 = dist(p[0], p[1]);
  if (d0 < 1) return start;
  const factor = dist(q[0], q[1]) / d0;
  const m0 = mid(p[0], p[1]);
  const m1 = mid(q[0], q[1]);
  const b = screenToBoard(start, f, m0.x, m0.y);
  return viewAnchored(start.w / factor, b, f, m1.x, m1.y);
}

/** 트랙패드 핀치로 보는 최대 변화량. 마우스 휠은 한 칸이 보통 ±100(또는 줄 단위)이라 이보다 크다. */
const PINCH_MAX_DELTA = 40;

/**
 * 휠 한 번의 확대 비율. deltaY<0이면 확대.
 * 트랙패드 핀치는 Ctrl이 눌린 채 작은 값(fractional)으로 와서 더 크게 반영하고,
 * Ctrl·Cmd를 누른 마우스 휠은 일반 휠과 같은 비율로 한 칸에 약 1.2배씩 움직인다.
 */
export function wheelFactor(deltaY: number, deltaMode = 0, ctrl = false): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const pinch = ctrl && deltaMode === 0 && Math.abs(px) < PINCH_MAX_DELTA;
  const k = pinch ? 0.01 : 0.0018;
  return Math.exp(-clamp(px, -240, 240) * k);
}

// ── 격자 ────────────────────────────────────────────────

export interface GridLike {
  size: number;
  show?: boolean;
  snap?: boolean;
}

/** 칸 중앙으로 맞춘 점. 보드 밖으로 나가지 않는다. */
export function snapPoint(p: Pt, size: number): Pt {
  if (!(size > 0)) return p;
  const snap = (v: number, max: number) => {
    const last = Math.max(0, Math.ceil(max / size) - 1); // 보드 안의 마지막 칸
    return Math.min(max, Math.min(last, Math.max(0, Math.floor(v / size))) * size + size / 2);
  };
  return { x: snap(p.x, W), y: snap(p.y, H) };
}

/** 칸 교차점(모서리)으로 맞춘 점. 자의 끝점처럼 칸 사이를 재는 데 쓴다. */
export function snapCorner(p: Pt, size: number): Pt {
  if (!(size > 0)) return p;
  return { x: clamp(Math.round(p.x / size) * size, 0, W), y: clamp(Math.round(p.y / size) * size, 0, H) };
}

// ── 자 ──────────────────────────────────────────────────

/** 두 점 사이 거리: 보드 단위와 칸 수 */
export function rulerDistance(a: Pt, b: Pt, cell = DEFAULT_CELL): { units: number; cells: number } {
  const units = dist(a, b);
  return { units, cells: units / (cell > 0 ? cell : DEFAULT_CELL) };
}

/** 사람에게 보이는 거리 글자. 칸 수는 소수 첫째 자리까지, 뒤에 보드 단위를 괄호로 붙인다. */
export function formatDistance(a: Pt, b: Pt, cell = DEFAULT_CELL): string {
  const r = rulerDistance(a, b, cell);
  const cells = Math.round(r.cells * 10) / 10;
  return `${Number.isInteger(cells) ? cells : cells.toFixed(1)}칸 (${Math.round(r.units)})`;
}

// ── 글자와 토큰 크기 ────────────────────────────────────

/** 토큰 이름표의 최소 화면 글자 크기(px) */
export const MIN_LABEL_PX = 11.5;
/** 토큰 몸통의 최소 화면 지름(px). 멀리서 봐도 눌러 볼 수 있게 한다. */
export const MIN_TOKEN_PX = 34;

/** 이름표 글자 크기(보드 단위). 축소해도 화면에서 MIN_LABEL_PX 아래로 줄지 않는다. */
export function labelUnits(base: number, scale: number): number {
  return Math.min(base * 3, Math.max(base, MIN_LABEL_PX / (scale || 1)));
}

/** 토큰 몸통(링·배지·막대 포함)을 키우는 배율. 보통은 1이고, 많이 축소했을 때만 커진다. */
export function tokenScale(baseDiameter: number, scale: number): number {
  return Math.min(2.5, Math.max(1, MIN_TOKEN_PX / ((baseDiameter * (scale || 1)) || 1)));
}

/** 눌림 판정 반지름(보드 단위): 화면에서 지름 44px 이상 */
export function hitRadius(base: number, scale: number): number {
  return Math.max(base, 22 / (scale || 1));
}

// ── 보관 ────────────────────────────────────────────────

export const viewKey = (userId: string, roomId: string, sceneId: string) => `coc-vtt.view.${userId}.${roomId}.${sceneId}`;

/** 보관해 둔 값을 보기로. 모양이 이상하면 null. */
export function parseView(raw: string | null): View | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<View> | null;
    if (!j || ![j.x, j.y, j.w].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    return clampView({ x: j.x!, y: j.y!, w: j.w! });
  } catch {
    return null;
  }
}
export const serializeView = (v: View) => JSON.stringify({ x: Math.round(v.x * 10) / 10, y: Math.round(v.y * 10) / 10, w: Math.round(v.w * 10) / 10 });

export function loadView(key: string): View | null {
  try {
    return parseView(localStorage.getItem(key));
  } catch {
    return null;
  }
}
export function saveView(key: string, v: View): void {
  try {
    if (isFit(v)) localStorage.removeItem(key);
    else localStorage.setItem(key, serializeView(v));
  } catch {
    /* 저장소를 못 쓰면 이번 화면에서만 유지된다 */
  }
}

/** 격자 맞춤을 이 사람이 따로 켜거나 끈 값(장면별) */
export const snapKey = (userId: string, roomId: string, sceneId: string) => `coc-vtt.snap.${userId}.${roomId}.${sceneId}`;
export function loadSnap(key: string): boolean | null {
  try {
    const v = localStorage.getItem(key);
    return v === "1" ? true : v === "0" ? false : null;
  } catch {
    return null;
  }
}
export function saveSnap(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? "1" : "0");
  } catch {
    /* 이번 화면에서만 유지된다 */
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
