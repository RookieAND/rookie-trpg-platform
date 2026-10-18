/**
 * 토큰 상태 표식(Roll20의 상태 아이콘 같은 것). 토큰에 붙여 "기절", "중독" 같은 상태를 모두가 한눈에 보게 한다.
 * 색만으로 구분하지 않도록 표식마다 모양·기호·색이 모두 다르다.
 * 시트의 부상 상태(토큰 위의 상태 칩)와는 따로 저장하는 GM·PL의 표시이고, 같은 뜻이면 화면에서 겹쳐 그리지 않는다.
 */

export const MARKER_KEYS = ["stun", "poison", "bleed", "fear", "madness", "hidden", "focus", "help", "dead", "custom"] as const;
export type MarkerKey = (typeof MARKER_KEYS)[number];

/** 사용자 지정 표식에 적는 글의 최대 길이 */
export const MARKER_TEXT_MAX = 8;
/** 토큰 하나가 가질 수 있는 표식 수 */
export const MAX_MARKERS = 10;
/** 토큰 옆에 그릴 표식의 최대 수(넘으면 "+n") */
export const MARKERS_VISIBLE = 4;

export type MarkerShape = "circle" | "square" | "diamond" | "triangle" | "hexagon" | "octagon" | "shield" | "pill" | "flag" | "star";

export interface MarkerDef {
  key: MarkerKey;
  label: string;
  /** 모양 안에 그리는 기호(한 글자) */
  glyph: string;
  shape: MarkerShape;
  color: string;
}

export const MARKER_DEFS: readonly MarkerDef[] = [
  { key: "stun", label: "기절", glyph: "✦", shape: "diamond", color: "#f0b429" },
  { key: "poison", label: "중독", glyph: "☠", shape: "hexagon", color: "#7bd88f" },
  { key: "bleed", label: "출혈", glyph: "●", shape: "circle", color: "#e5484d" },
  { key: "fear", label: "공포", glyph: "!", shape: "triangle", color: "#b18cf5" },
  { key: "madness", label: "광기", glyph: "?", shape: "octagon", color: "#ff7ac6" },
  { key: "hidden", label: "은신", glyph: "◐", shape: "pill", color: "#7f8aa3" },
  { key: "focus", label: "집중", glyph: "◎", shape: "square", color: "#4fb3ff" },
  { key: "help", label: "도움 필요", glyph: "+", shape: "shield", color: "#ff9f43" },
  { key: "dead", label: "사망", glyph: "✕", shape: "flag", color: "#9aa0a6" },
  { key: "custom", label: "사용자 지정 1", glyph: "★", shape: "star", color: "#5eead4" },
];

export const MARKER_DEF: Readonly<Record<MarkerKey, MarkerDef>> = Object.fromEntries(MARKER_DEFS.map((d) => [d.key, d])) as Record<MarkerKey, MarkerDef>;

export const isMarkerKey = (k: unknown): k is MarkerKey => typeof k === "string" && (MARKER_KEYS as readonly string[]).includes(k);

/**
 * 오브젝트에 저장된 표식 하나. key는 새 버전이 더한 표식도 읽을 수 있게 글로 둔다(모르는 key는 일반 표식으로 그린다).
 * secret이면 GM만 본다(서버가 다른 사람에게는 보내지 않는다).
 */
export interface Marker {
  key: string;
  secret?: boolean;
  /** 사용자 지정(custom) 표식의 글 */
  text?: string;
}

const KEY_SHAPE = /^[a-z][a-z0-9_]{0,19}$/;

/** 저장된 값에서 모양이 맞는 표식만 골라 key마다 하나씩 남긴다. 모르는 key도 모양이 맞으면 남긴다(앞선 버전이 쓴 것). */
export function sanitizeMarkers(raw: unknown): Marker[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Marker[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const { key, secret, text } = m as { key?: unknown; secret?: unknown; text?: unknown };
    if (typeof key !== "string" || !KEY_SHAPE.test(key) || seen.has(key)) continue;
    const t = typeof text === "string" ? text.trim().slice(0, MARKER_TEXT_MAX) : "";
    if (key === "custom" && !t) continue;
    seen.add(key);
    out.push({ key, ...(secret === true ? { secret: true } : {}), ...(key === "custom" ? { text: t } : {}) });
    if (out.length >= MAX_MARKERS) break;
  }
  return out;
}

/** 보는 사람에게 보여도 되는 표식: GM은 전부, 나머지는 비밀이 아닌 것만 */
export function markersFor(markers: readonly Marker[] | undefined, role: string): Marker[] {
  if (!markers?.length) return [];
  return role === "kp" ? markers.map((m) => ({ ...m })) : markers.filter((m) => !m.secret).map((m) => ({ ...m }));
}

export function markerLabel(m: Marker): string {
  const def = isMarkerKey(m.key) ? MARKER_DEF[m.key] : undefined;
  if (m.key === "custom") return m.text || "사용자 지정";
  return def?.label ?? m.key;
}

/** 시트의 부상 상태 칩이 이미 같은 뜻을 보여 주는 표식은 겹쳐 그리지 않는다(기절·사망). */
export function dedupeMarkers(markers: readonly Marker[], wound: readonly string[] | undefined): Marker[] {
  if (!wound?.length) return [...markers];
  return markers.filter((m) => !((m.key === "stun" && wound.includes("unconscious")) || (m.key === "dead" && wound.includes("dead"))));
}

/** 화면에 그릴 표식과 넘친 개수 */
export function splitMarkers(markers: readonly Marker[], limit = MARKERS_VISIBLE): { shown: Marker[]; more: number } {
  return { shown: markers.slice(0, limit), more: Math.max(0, markers.length - limit) };
}

/** 표식을 켜거나 끈 새 목록. 같은 key는 하나만 둔다. 바뀐 것이 없으면 null. */
export function applyMarker(list: readonly Marker[] | undefined, key: string, on: boolean, opts: { secret?: boolean; text?: string } = {}): Marker[] | null {
  const cur = list ?? [];
  const at = cur.findIndex((m) => m.key === key);
  if (!on) return at < 0 ? null : cur.filter((m) => m.key !== key);
  const next: Marker = { key, ...(opts.secret ? { secret: true } : {}), ...(key === "custom" ? { text: (opts.text ?? "").trim().slice(0, MARKER_TEXT_MAX) } : {}) };
  if (at >= 0) {
    const old = cur[at]!;
    if (Boolean(old.secret) === Boolean(next.secret) && (old.text ?? "") === (next.text ?? "")) return null;
    return cur.map((m, i) => (i === at ? next : m));
  }
  return [...cur, next];
}
