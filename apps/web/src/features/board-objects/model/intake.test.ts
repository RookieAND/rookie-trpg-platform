import { describe, expect, it } from "vitest";
import { intakeCommand, intakeOptions, nameFromFile } from "./intake";

describe("intakeOptions", () => {
  it("고른 오브젝트가 없으면 세 가지", () => {
    expect(intakeOptions().map((o) => o.label)).toEqual(["배경으로", "새 토큰으로", "소품으로"]);
  });
  it("고른 오브젝트가 있으면 그 이미지로 바꾸는 선택지가 맨 위", () => {
    const o = intakeOptions({ name: "고블린" });
    expect(o[0]).toEqual({ choice: "selected", label: "‘고블린’ 이미지로" });
    expect(o).toHaveLength(4);
  });
  it("긴 이름은 줄여 보여 준다", () => {
    expect(intakeOptions({ name: "아주아주아주아주긴이름의토큰" })[0]!.label).toContain("…");
  });
});

describe("nameFromFile", () => {
  it("확장자를 떼고 밑줄을 공백으로", () => {
    expect(nameFromFile("늙은_선원.png", "토큰")).toBe("늙은 선원");
  });
  it("붙여 넣은 그림의 흔한 이름이나 빈 이름은 fallback", () => {
    expect(nameFromFile("image.png", "토큰")).toBe("토큰");
    expect(nameFromFile(".png", "소품")).toBe("소품");
  });
  it("36자를 넘으면 자른다", () => {
    expect(nameFromFile(`${"가".repeat(50)}.jpg`, "토큰")).toHaveLength(36);
  });
});

describe("intakeCommand", () => {
  const c = { image: "img1", sceneId: "s1", x: 312.6, y: 40, name: "토큰", selectedId: "o1" };
  it("배경", () => {
    expect(intakeCommand("background", c)).toEqual({ type: "scene.background", data: { id: "s1", image: "img1" } });
  });
  it("새 토큰·소품은 놓은 자리 근처 빈자리에 이름과 이미지를 달아 추가", () => {
    expect(intakeCommand("token", c)).toMatchObject({ type: "object.add", data: { kind: "token", name: "토큰", image: "img1", x: 313, y: 40, sceneId: "s1", autoPlace: true } });
    expect(intakeCommand("prop", c)).toMatchObject({ data: { kind: "prop" } });
  });
  it("선택한 오브젝트의 이미지 바꾸기", () => {
    expect(intakeCommand("selected", c)).toEqual({ type: "object.update", data: { id: "o1", image: "img1" } });
    expect(intakeCommand("selected", { ...c, selectedId: undefined })).toBeNull();
  });
});
