import { describe, expect, it } from "vitest";
import { INITIAL_PANELS, panelsReducer, selectLabel, type PanelAction, type PhonePanels } from "./phone-panels";

const run = (...a: PanelAction[]): PhonePanels => a.reduce(panelsReducer, INITIAL_PANELS);

describe("휴대폰 판 상태", () => {
  it("처음에는 모두 접혀 있다", () => {
    expect(INITIAL_PANELS).toEqual({ sheetOpen: false, sheetTab: "place", drawerOpen: false });
  });
  it("시트를 열고 닫고, 탭을 바꿔도 열린 채 유지된다", () => {
    expect(run({ type: "sheet.toggle" }).sheetOpen).toBe(true);
    expect(run({ type: "sheet.toggle" }, { type: "sheet.toggle" }).sheetOpen).toBe(false);
    const s = run({ type: "sheet.open" }, { type: "sheet.tab", tab: "fog" });
    expect(s).toMatchObject({ sheetOpen: true, sheetTab: "fog" });
    expect(run({ type: "sheet.open", tab: "select" }).sheetTab).toBe("select");
  });
  it("시트와 서랍은 한꺼번에 열리지 않는다", () => {
    const a = run({ type: "sheet.open" }, { type: "drawer.open" });
    expect(a).toMatchObject({ sheetOpen: false, drawerOpen: true });
    const b = run({ type: "drawer.open" }, { type: "sheet.toggle" });
    expect(b).toMatchObject({ sheetOpen: true, drawerOpen: false });
    expect(run({ type: "drawer.open" }, { type: "sheet.open", tab: "cues" })).toMatchObject({ drawerOpen: false, sheetOpen: true, sheetTab: "cues" });
  });
  it("Esc는 서랍, 시트 순으로 하나씩 닫는다", () => {
    expect(run({ type: "sheet.open" }, { type: "escape" }).sheetOpen).toBe(false);
    expect(run({ type: "drawer.open" }, { type: "escape" }).drawerOpen).toBe(false);
    expect(run({ type: "escape" })).toEqual(INITIAL_PANELS);
  });
  it("선택이 풀리면 선택 묶음에서 놓기로 돌아간다", () => {
    expect(run({ type: "sheet.open", tab: "select" }, { type: "selection.cleared" }).sheetTab).toBe("place");
    expect(run({ type: "sheet.open", tab: "fog" }, { type: "selection.cleared" }).sheetTab).toBe("fog");
  });
  it("선택 버튼 글자: 이름이 길면 줄인다", () => {
    expect(selectLabel(undefined)).toBe("선택");
    expect(selectLabel("괴물")).toBe("선택: 괴물");
    expect(selectLabel("아주아주긴이름의토큰")).toBe("선택: 아주아주긴이…");
  });
});
