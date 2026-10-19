import { describe, expect, it } from "vitest";
import { LIMITS } from "./limits";
import { clientCommandSchema, type ClientCommand } from "./protocol";

const long = (n: number) => "가".repeat(n);
const ok = (c: unknown) => clientCommandSchema.safeParse(c).success;

describe("입력 한도는 서버 규격과 같다", () => {
  const cases: Array<[string, (s: string) => unknown, number]> = [
    ["핸드아웃 제목", (title) => ({ type: "handout.create", data: { title, body: "" } }), LIMITS.handoutTitle],
    ["핸드아웃 내용", (body) => ({ type: "handout.create", data: { title: "a", body } }), LIMITS.handoutBody],
    ["장면 이름", (name) => ({ type: "scene.create", data: { name } }), LIMITS.sceneName],
    ["장면 이름 바꾸기", (name) => ({ type: "scene.rename", data: { id: "s", name } }), LIMITS.sceneName],
    ["토큰 이름", (name) => ({ type: "object.add", data: { kind: "token", name, x: 1, y: 1 } }), LIMITS.objectName],
    ["표식 글", (text) => ({ type: "object.marker", data: { id: "o", key: "custom", on: true, text } }), LIMITS.markerText],
  ];
  for (const [label, make, max] of cases) {
    it(`${label}: ${max}자는 되고 ${max + 1}자는 안 돼요`, () => {
      expect(ok(make(long(max)))).toBe(true);
      expect(ok(make(long(max + 1)))).toBe(false);
    });
  }
  it("캐릭터 이름", () => {
    const c = (name: string): ClientCommand => ({ type: "character.add", data: { name, age: 30, occupation: "", characteristics: Object.fromEntries(["STR", "CON", "SIZ", "DEX", "APP", "INT", "POW", "EDU"].map((k) => [k, 50])) as never } } as never);
    expect(ok(c(long(LIMITS.characterName)))).toBe(true);
    expect(ok(c(long(LIMITS.characterName + 1)))).toBe(false);
  });
  it("대화는 서버 글자 수와 같은 값을 써요", () => {
    expect(LIMITS.chat).toBe(500);
  });
});
