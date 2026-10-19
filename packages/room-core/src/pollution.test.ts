import { describe, expect, it } from "vitest";
import { SCENARIO_FORMAT, clientCommandSchema, parseScenario, parseSheetCsv, characterInputSchema, librarySchema, UNSAFE_KEY_MESSAGE, type ClientCommand } from "@coc-vtt/shared";
import { Room, type Actor } from "./room";

/** S-01: 기능 이름 같은 사용자 글자가 객체 키로 쓰이는 모든 길에서 Object.prototype이 바뀌지 않아야 한다. */

const kp: Actor = { userId: "kp1", name: "하늘", role: "kp" };
const pl: Actor = { userId: "pl1", name: "서하", role: "pl" };
const BAD = ["__proto__", "constructor", "prototype", "hasOwnProperty", "toString", "valueOf"];

let n = 0;
const cmd = <T extends ClientCommand["type"]>(type: T, data: Extract<ClientCommand, { type: T }>["data"]) => ({ type, data }) as ClientCommand;
const base = {
  name: "윤서하",
  age: 27,
  occupation: "기자",
  characteristics: { STR: 50, CON: 60, SIZ: 60, DEX: 60, APP: 50, INT: 70, POW: 60, EDU: 70 },
  luck: 55,
  skills: [{ name: "관찰력", value: 40, grown: false }],
};

const protoSnapshot = () => ({
  keys: Object.getOwnPropertyNames(Object.prototype).sort(),
  fnKeys: Object.getOwnPropertyNames(Function.prototype).sort(),
});
const expectClean = (before: ReturnType<typeof protoSnapshot>) => {
  expect(({}) as Record<string, unknown>).not.toHaveProperty("polluted");
  expect(({}) as Record<string, unknown>).not.toHaveProperty("value");
  expect(({}) as Record<string, unknown>).not.toHaveProperty("grown");
  expect(protoSnapshot()).toEqual(before);
  expect(Object.getPrototypeOf(Object.prototype)).toBeNull();
};

const room = () => {
  const r = new Room("r", { newId: () => `id-${++n}` });
  r.join(kp);
  r.join(pl);
  r.handle(kp, cmd("session.start", {}));
  return r;
};

describe("기능 이름으로 Object.prototype을 건드릴 수 없다", () => {
  for (const name of BAD) {
    it(`sheet.patch 기능 '${name}'을 PL·GM 모두 거절하고 프로토타입은 그대로`, () => {
      const before = protoSnapshot();
      const r = room();
      const added = r.handle(pl, cmd("character.add", base as never));
      expect(added.ok).toBe(true);
      const id = r.snapshot(pl).characters[0]!.id;
      for (const who of [pl, kp]) {
        for (const op of [{ path: "skill", name, grown: true }, { path: "skill", name, value: 1 }, { path: "skill", name, delta: 5 }]) {
          const res = r.handle(who, cmd("sheet.patch", { characterId: id, ops: [op] } as never));
          expect(res.ok).toBe(false);
        }
      }
      expectClean(before);
      // 다른 기능은 평소처럼 고쳐진다(오염된 value·grown이 끼어들지 않는다)
      const ok = r.handle(kp, cmd("sheet.patch", { characterId: id, ops: [{ path: "skill", name: "관찰력", delta: 1 }] }));
      expect(ok.ok).toBe(true);
      expect(r.snapshot(kp).characters[0]!.skills["관찰력"]).toEqual({ value: 41, grown: false });
      // 시트에 없는 기능에 grown만 주면 그냥 "없는 기능" 오류여야 한다(상속된 항목으로 보이면 안 된다)
      const missing = r.handle(pl, cmd("sheet.patch", { characterId: id, ops: [{ path: "skill", name: "없는기능", grown: true }] }));
      expect(missing.ok).toBe(false);
    });

    it(`character.add에 기능 '${name}'이 있어도 원형이 바뀌지 않고 그 기능은 버려진다`, () => {
      const before = protoSnapshot();
      const r = room();
      const added = r.handle(pl, cmd("character.add", { ...base, skills: [{ name, value: 99, grown: true }, { name: "관찰력", value: 40, grown: false }] } as never));
      expect(added.ok).toBe(true);
      const c = r.snapshot(pl).characters[0]!;
      expect(Object.keys(c.skills)).toEqual(["관찰력"]);
      expect(Object.getPrototypeOf(c.skills) === Object.prototype || Object.getPrototypeOf(c.skills) === null).toBe(true);
      expect(Object.getPrototypeOf(c.skills)).not.toHaveProperty("value");
      expectClean(before);
    });
  }

  it("굴림 목표값을 찾을 때 상속된 이름은 없는 기능으로 본다", () => {
    const r = room();
    r.handle(pl, cmd("character.add", base as never));
    const id = r.snapshot(pl).characters[0]!.id;
    for (const name of BAD) {
      const res = r.handle(pl, cmd("roll.request", { skill: name, characterId: id } as never));
      if (res.ok) {
        // 굴림이 만들어졌다면 목표값이 NaN·함수 같은 값이면 안 된다
        const roll = res.out.map((o) => o.event).find((e) => e.type === "roll.result");
        expect(JSON.stringify(roll ?? {})).not.toMatch(/NaN|function/);
      }
    }
    expect(({}) as Record<string, unknown>).not.toHaveProperty("polluted");
  });

  it("저장돼 있던 옛 데이터의 위험한 기능 이름은 불러올 때 걸러진다", () => {
    const before = protoSnapshot();
    const r = room();
    r.handle(pl, cmd("character.add", base as never));
    const data = JSON.parse(JSON.stringify(r.toData())) as ReturnType<Room["toData"]>;
    // JSON.parse로 만든 객체의 __proto__는 평범한 자기 키가 된다
    data.characters![0]!.skills = JSON.parse('{"__proto__":{"value":1,"grown":true},"constructor":{"value":2,"grown":false},"관찰력":{"value":40,"grown":false}}');
    const back = Room.fromData(data);
    const c = back.snapshot(kp).characters[0]!;
    expect(Object.keys(c.skills)).toEqual(["관찰력"]);
    expectClean(before);
  });
});

describe("스키마 단계에서 막는다 (친절한 한국어 오류)", () => {
  for (const name of BAD) {
    it(`protocol: ${name}`, () => {
      const patch = clientCommandSchema.safeParse({ type: "sheet.patch", data: { characterId: "c", ops: [{ path: "skill", name, grown: true }] } });
      expect(patch.success).toBe(false);
      if (!patch.success) expect(JSON.stringify(patch.error.issues)).toContain(UNSAFE_KEY_MESSAGE);
      expect(characterInputSchema.safeParse({ ...base, skills: [{ name, value: 1 }] }).success).toBe(false);
      expect(clientCommandSchema.safeParse({ type: "character.add", data: { ...base, skills: [{ name, value: 1 }] } }).success).toBe(false);
    });
  }

  it("시나리오·백업 가져오기: 기능 이름 오류가 위치와 함께 나온다", () => {
    const doc = {
      format: SCENARIO_FORMAT,
      version: 1,
      roomName: "x",
      scenes: [{ key: "a", name: "장면" }],
      characters: [{ name: "NPC", age: 30, characteristics: base.characteristics, skills: [{ name: "__proto__", value: 10 }] }],
    };
    const r = parseScenario(doc);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.message === UNSAFE_KEY_MESSAGE)).toBe(true);
      expect(r.errors[0]!.where).toContain("characters");
    }
    expect(({}) as Record<string, unknown>).not.toHaveProperty("value");
  });

  it("JSON.parse로 만든 __proto__ 키 문서도 오염 없이 거절", () => {
    const before = protoSnapshot();
    const text = '{"format":"roll-and-call-scenario","version":1,"roomName":"x","__proto__":{"polluted":"yes"},"scenes":[{"key":"a","name":"장면"}],"characters":[{"name":"N","age":30,"characteristics":{"STR":50,"CON":50,"SIZ":50,"DEX":50,"APP":50,"INT":50,"POW":50,"EDU":50},"skills":[{"name":"constructor","value":1}]}]}';
    const r = parseScenario(JSON.parse(text));
    expect(r.ok).toBe(false);
    expectClean(before);
  });

  it("시트 CSV: 위험한 기능 이름은 건너뛰고, 구역 이름이 constructor여도 오염이 없다", () => {
    const before = protoSnapshot();
    const csv = ["밤의 탁자 캐릭터 시트,1", "[기본 정보]", "constructor,x", "__proto__,y", "이름,윤서하", "나이,30", "[특성치]", "STR,50", "CON,50", "SIZ,50", "DEX,50", "APP,50", "INT,50", "POW,50", "EDU,50", "[기능]", "기능,값,성장", "__proto__,50,O", "constructor,40", "관찰력,30"].join("\n");
    const r = parseSheetCsv(csv);
    expect(r.errors).toEqual([]);
    const names = (r.data?.skills ?? []).map((s) => s.name);
    expect(names).not.toContain("__proto__");
    expect(names).not.toContain("constructor");
    expect(names).toContain("관찰력");
    expectClean(before);
  });

  it("서재(직업 기능)도 막는다", () => {
    const lib = { macros: [], occupations: [{ id: "o", name: "직업", formula: "edu4", creditMin: 0, creditMax: 50, skills: ["__proto__"] }] };
    expect(librarySchema.safeParse(lib).success).toBe(false);
  });
});
