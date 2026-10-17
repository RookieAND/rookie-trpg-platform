export const SLOT_COUNT = 9;
export type Slots = Array<string | null>;

export const emptySlots = (): Slots => Array.from({ length: SLOT_COUNT }, () => null);

export function assignSlot(slots: Slots, index: number, cueId: string): Slots {
  if (index < 0 || index >= SLOT_COUNT) return slots;
  // 같은 동작이 두 칸에 있으면 헷갈리므로 옮겨 담는다.
  return slots.map((s, i) => (i === index ? cueId : s === cueId ? null : s));
}

export function clearSlot(slots: Slots, index: number): Slots {
  return slots.map((s, i) => (i === index ? null : s));
}

/** 저장된 값이 깨졌거나 길이가 달라도 9칸으로 맞춘다. */
export function parseSlots(raw: string | null): Slots {
  try {
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(v)) return emptySlots();
    return Array.from({ length: SLOT_COUNT }, (_, i) => (typeof v[i] === "string" ? (v[i] as string) : null));
  } catch {
    return emptySlots();
  }
}
