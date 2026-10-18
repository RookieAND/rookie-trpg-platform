import { describe, expect, it } from "vitest";
import type { GameObject } from "@coc-vtt/shared";
import { clampToViewport, duplicateCommand } from "./object-actions";

const obj = (o: Partial<GameObject> = {}): GameObject => ({ id: "o1", sceneId: "s1", kind: "token", name: "고블린", x: 200, y: 300, layer: "object", visibleTo: "all", locked: true, rev: 4, ownerId: "pl1", image: "img1", ...o });

describe("duplicateCommand", () => {
  it("이름에 번호를 붙이고 조금 옮긴 자리에 같은 모양으로 추가한다", () => {
    const { command, name } = duplicateCommand(obj(), ["고블린"]);
    expect(name).toBe("고블린 2");
    expect(command).toEqual({ type: "object.add", data: { kind: "token", name: "고블린 2", x: 240, y: 340, layer: "object", visibleTo: "all", sceneId: "s1", image: "img1" } });
  });
  it("소유자와 잠금은 잇지 않는다", () => {
    const { command } = duplicateCommand(obj(), []);
    expect(JSON.stringify(command)).not.toContain("pl1");
    expect(JSON.stringify(command)).not.toContain("locked");
  });
  it("GM 전용(숨김) 오브젝트는 숨긴 채로 복제", () => {
    const { command } = duplicateCommand(obj({ layer: "gm", image: undefined }), []);
    expect(command).toMatchObject({ data: { layer: "gm" } });
    expect(JSON.stringify(command)).not.toContain("image");
  });
});

describe("clampToViewport", () => {
  it("화면 안이면 그대로", () => {
    expect(clampToViewport(100, 120, 180, 200, 1280, 800)).toEqual({ left: 100, top: 120 });
  });
  it("오른쪽·아래로 넘치면 안쪽으로 당긴다", () => {
    expect(clampToViewport(1270, 790, 180, 200, 1280, 800)).toEqual({ left: 1092, top: 592 });
  });
});
