import { MARKER_DEFS, MARKER_TEXT_MAX, type ClientCommand, type GameObject, type Marker, type MarkerKey } from "@coc-vtt/shared";

/** 표식 한 줄을 켜거나 끄는 명령. 사용자 지정(custom)은 글이 비어 있으면 null이다. */
export function markerCommand(obj: Pick<GameObject, "id">, key: MarkerKey, on: boolean, opts: { secret?: boolean; text?: string } = {}): ClientCommand | null {
  const text = opts.text?.trim().slice(0, MARKER_TEXT_MAX);
  if (on && key === "custom" && !text) return null;
  return { type: "object.marker", data: { id: obj.id, key, on, ...(on && opts.secret ? { secret: true } : {}), ...(on && key === "custom" ? { text: text! } : {}) } };
}

export interface MarkerRow {
  key: MarkerKey;
  label: string;
  on: boolean;
  secret: boolean;
  text: string;
}

/** 패널에 보일 열 줄. 저장된 표식과 맞춰 켜짐·비밀·글을 채운다. */
export function markerRows(markers: readonly Marker[] | undefined): MarkerRow[] {
  return MARKER_DEFS.map((d) => {
    const m = markers?.find((x) => x.key === d.key);
    return { key: d.key, label: d.label, on: Boolean(m), secret: m?.secret === true, text: m?.text ?? "" };
  });
}

/** 이 사람이 이 토큰의 표식을 바꿀 수 있는가(서버와 같은 규칙: GM은 모든 토큰, PL은 자기 토큰) */
export function canEditMarkers(role: string, userId: string, obj: Pick<GameObject, "kind" | "ownerId">): boolean {
  if (obj.kind !== "token") return false;
  return role === "kp" || (role === "pl" && obj.ownerId === userId);
}
