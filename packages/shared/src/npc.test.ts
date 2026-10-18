import { describe, expect, it } from "vitest";
import { deriveCharacter } from "./sheet";
import { characterInputSchema } from "./protocol";
import { NPC_PRESETS, buildQuickNpc, quickNpcPreview } from "./npc";

describe("빠른 NPC", () => {
  it("모든 예시가 시트 규격을 통과하고 HP·DEX·피해 보너스가 맞아요", () => {
    for (const p of NPC_PRESETS) {
      const input = characterInputSchema.parse(buildQuickNpc({ name: p.label, ...p.values }));
      const d = deriveCharacter({ characteristics: input.characteristics, age: input.age });
      expect(d.limits.hp, p.label).toBe(p.values.hp);
      expect(input.hp).toBe(p.values.hp);
      expect(input.characteristics.DEX).toBe(p.values.dex);
      expect(input.weapons).toHaveLength(1);
      expect(input.skills.find((s) => s.name === "맨손 격투")?.value).toBe(p.values.fight);
    }
  });
  it("HP가 어떤 SIZ에서도 맞춰지고, 범위를 벗어난 값은 허용 범위로 맞춰요", () => {
    for (const siz of [1, 30, 99]) for (const hp of [1, 10, 19]) {
      const input = buildQuickNpc({ name: "시험", hp, str: 50, siz, dex: 50, fight: 40 });
      expect(characterInputSchema.safeParse(input).success).toBe(true);
      expect(deriveCharacter({ characteristics: input.characteristics, age: 30 }).limits.hp).toBe(hp);
    }
    const wild = buildQuickNpc({ name: "시험", hp: 500, str: 500, siz: -3, dex: 0, fight: 900 });
    expect(wild.hp).toBe(19);
    expect(wild.skills.find((s) => s.name === "맨손 격투")?.value).toBe(100);
  });
  it("방어구는 메모에, 회피는 DEX의 절반이 기본이에요", () => {
    const n = buildQuickNpc({ name: "경비", hp: 10, str: 50, siz: 60, dex: 60, fight: 50, armor: 2, weaponName: "총", weaponSkill: "사격(권총)", weaponDamage: "1d10" });
    expect(n.notes).toBe("방어구 2");
    expect(n.skills.find((s) => s.name === "회피")?.value).toBe(30);
    expect(n.skills.find((s) => s.name === "사격(권총)")?.value).toBe(50);
    expect(n.weapons).toEqual([{ name: "총", skill: "사격(권총)", damage: "1d10" }]);
  });
  it("피해 보너스를 미리 보여 줘요", () => {
    expect(quickNpcPreview({ str: 90, siz: 90, hp: 18 }).damageBonus).toBe("1d6");
    expect(quickNpcPreview({ str: 50, siz: 50, hp: 10 }).damageBonus).toBe("0");
  });
});
