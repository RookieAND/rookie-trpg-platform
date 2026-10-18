/**
 * 휴대폰 화면의 두 가지 떠 있는 판의 상태.
 *  - 도구 시트(GM): 아래 줄 위로 펼쳐지는 놓기·안개·선택·연출 묶음
 *  - 패널 서랍: 굴림·시트·대화 같은 오른쪽 패널을 화면 가득 펼친 것
 * 둘은 같은 자리를 쓰므로 한쪽을 펴면 다른 쪽은 접는다.
 */
export type SheetTab = "place" | "fog" | "select" | "cues";
export const SHEET_TABS: readonly SheetTab[] = ["place", "fog", "select", "cues"];

export interface PhonePanels {
  sheetOpen: boolean;
  sheetTab: SheetTab;
  drawerOpen: boolean;
}
export const INITIAL_PANELS: PhonePanels = { sheetOpen: false, sheetTab: "place", drawerOpen: false };

export type PanelAction =
  | { type: "sheet.toggle" }
  | { type: "sheet.open"; tab?: SheetTab }
  | { type: "sheet.close" }
  | { type: "sheet.tab"; tab: SheetTab }
  | { type: "drawer.open" }
  | { type: "drawer.close" }
  /** Esc: 서랍이 열려 있으면 서랍을, 아니면 시트를 닫는다 */
  | { type: "escape" }
  /** 고른 오브젝트가 없어졌다: 선택 묶음을 보고 있었다면 놓기로 돌아간다 */
  | { type: "selection.cleared" };

export function panelsReducer(s: PhonePanels, a: PanelAction): PhonePanels {
  switch (a.type) {
    case "sheet.toggle":
      return s.sheetOpen ? { ...s, sheetOpen: false } : { ...s, sheetOpen: true, drawerOpen: false };
    case "sheet.open":
      return { sheetOpen: true, sheetTab: a.tab ?? s.sheetTab, drawerOpen: false };
    case "sheet.close":
      return { ...s, sheetOpen: false };
    case "sheet.tab":
      return { ...s, sheetTab: a.tab };
    case "drawer.open":
      return { ...s, drawerOpen: true, sheetOpen: false };
    case "drawer.close":
      return { ...s, drawerOpen: false };
    case "escape":
      if (s.drawerOpen) return { ...s, drawerOpen: false };
      if (s.sheetOpen) return { ...s, sheetOpen: false };
      return s;
    case "selection.cleared":
      return s.sheetTab === "select" ? { ...s, sheetTab: "place" } : s;
  }
}

/** 접힌 도구 줄의 ‘선택’ 버튼에 쓸 글자. 고른 것이 없으면 안내 문구. */
export function selectLabel(name: string | undefined): string {
  if (!name) return "선택";
  const n = name.length > 6 ? `${name.slice(0, 6)}…` : name;
  return `선택: ${n}`;
}
