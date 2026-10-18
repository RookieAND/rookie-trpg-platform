import { describe, expect, it } from "vitest";
import { DEFAULT_EFFECTS, type ClientCommand } from "@coc-vtt/shared";
import { inAudience, Room, type Actor } from "./room";

const kp: Actor = { userId: "kp1", name: "하늘", role: "kp" };
const seo: Actor = { userId: "pl1", name: "윤서하", role: "pl" };
const cmd = <T extends ClientCommand["type"]>(type: T, data: Extract<ClientCommand, { type: T }>["data"]) =>
  ({ type, data }) as ClientCommand;

const setup = () => {
  const room = new Room("r");
  room.join(kp);
  room.join(seo);
  room.handle(kp, cmd("session.start", {}));
  return room;
};

describe("판정 효과 설정", () => {
  it("기본값: 대성공·극단·대실패는 켜짐, 어려운 성공은 꺼짐", () => {
    expect(setup().snapshot(seo).effects).toEqual(DEFAULT_EFFECTS);
  });

  it("GM이 바꾸면 모두에게 알려지고 snapshot에 반영된다", () => {
    const room = setup();
    const r = room.handle(kp, cmd("settings.effects", { level: "hard", enabled: true, intensity: 2 }));
    expect(r.ok && r.out.filter((o) => inAudience(o.audience, seo))).toHaveLength(1);
    expect(room.snapshot(seo).effects.hard).toEqual({ enabled: true, intensity: 2 });
    expect(room.snapshot(seo).effects.critical).toEqual(DEFAULT_EFFECTS.critical);
  });

  it("일부만 바꿔도 나머지 값은 유지한다", () => {
    const room = setup();
    room.handle(kp, cmd("settings.effects", { level: "critical", enabled: false }));
    expect(room.snapshot(kp).effects.critical).toEqual({ enabled: false, intensity: 3 });
    room.handle(kp, cmd("settings.effects", { level: "critical", intensity: 1 }));
    expect(room.snapshot(kp).effects.critical).toEqual({ enabled: false, intensity: 1 });
  });

  it("GM이 아니면 바꿀 수 없다", () => {
    expect(setup().handle(seo, cmd("settings.effects", { level: "fumble", enabled: false }))).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("저장·복원 뒤에도 유지되고, 옛 데이터는 기본값으로 읽는다", () => {
    const room = setup();
    room.handle(kp, cmd("settings.effects", { level: "fumble", enabled: false }));
    expect(Room.fromData(room.toData()).snapshot(kp).effects.fumble.enabled).toBe(false);
    const { effects: _drop, ...old } = room.toData();
    expect(Room.fromData(old).snapshot(kp).effects).toEqual(DEFAULT_EFFECTS);
  });

  it("기본값을 바꿔도 다른 룸의 기본값이 오염되지 않는다", () => {
    const a = setup();
    a.handle(kp, cmd("settings.effects", { level: "critical", enabled: false }));
    expect(DEFAULT_EFFECTS.critical.enabled).toBe(true);
    expect(setup().snapshot(kp).effects.critical.enabled).toBe(true);
  });
});
