import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ClientCommand } from "@coc-vtt/shared";
import { ROOM_SCHEMA_VERSION, migrateRoomData } from "./persist";
import { Room, type Actor, type RoomData } from "./room";

const kp: Actor = { userId: "kp1", name: "하늘", role: "kp" };
const pl: Actor = { userId: "pl1", name: "서하", role: "pl" };
const cmd = <T extends ClientCommand["type"]>(type: T, data: Extract<ClientCommand, { type: T }>["data"]) => ({ type, data }) as ClientCommand;

/** 대화·세션 기록이 생기기 전(schemaVersion 없음)의 저장 모양. master에서 만든 실제 데이터다. */
const oldFixture = (): RoomData => JSON.parse(readFileSync(new URL("./fixtures/room-v1.json", import.meta.url), "utf8")) as RoomData;

describe("옛 저장 데이터(schemaVersion 없음) 열기", () => {
  it("fixture에는 새 필드가 없다", () => {
    const f = oldFixture() as unknown as Record<string, unknown>;
    expect(f.schemaVersion).toBeUndefined();
    expect(f.chat).toBeUndefined();
    expect(f.log).toBeUndefined();
    expect(f.chatSettings).toBeUndefined();
  });

  it("그대로 열리고, 대화·기록·설정은 기본값으로 채워진다", () => {
    const room = Room.fromData(oldFixture());
    const data = room.toData();
    expect(data.schemaVersion).toBe(ROOM_SCHEMA_VERSION);
    expect(data.chat).toEqual([]);
    expect(data.log).toEqual([]);
    expect(data.chatSettings).toEqual({ plWhisper: false, spectatorChat: false, plSelfEdit: true });
    expect(room.chatHistory(kp)).toEqual([]);
    expect(room.logFor(kp)).toEqual({ entries: [], total: 0, hasMore: false });
    expect(room.snapshot(kp).chatSettings).toEqual({ plWhisper: false, spectatorChat: false, plSelfEdit: true });
  });

  it("옛 데이터의 내용(핸드아웃·굴림·장면·시트)은 그대로이고, 비밀 굴림은 PL에게 가지 않는다", () => {
    const room = Room.fromData(oldFixture());
    expect(room.snapshot(kp).handouts.map((h) => h.title)).toEqual(["찢어진 편지", "GM 메모"]);
    expect(room.snapshot(pl).handouts.map((h) => h.title)).toEqual(["찢어진 편지"]);
    expect(room.snapshot(kp).rolls).toHaveLength(2);
    expect(room.snapshot(pl).rolls).toHaveLength(1);
    expect(room.snapshot(kp).scenes.map((s) => s.name)).toEqual(["장면 1", "지하실"]);
    expect(room.snapshot(pl).characters.map((c) => c.name)).toEqual(["윤서하"]);
    // 진행 중이던 세션은 일시정지로 복원되고 GM이 돌아오면 이어진다
    expect(room.sessionStatus).toBe("PAUSED");
  });

  it("열고 나서 새 기능이 바로 동작하고, 다시 저장해도 새 필드가 남는다", () => {
    const room = Room.fromData(oldFixture(), { now: () => 1_800_000_000_000 });
    room.join(kp);
    room.join(pl);
    expect(room.sessionStatus).toBe("ACTIVE");
    expect(room.handle(pl, cmd("chat.send", { text: "다시 왔어요" })).ok).toBe(true);
    const saved = JSON.parse(JSON.stringify(room.toData())) as RoomData;
    expect(saved.chat).toHaveLength(1);
    expect(saved.log?.map((e) => e.type)).toContain("resume");
    expect(saved.log?.map((e) => e.type)).toContain("say");
    expect(Room.fromData(saved).chatHistory(pl)).toHaveLength(1);
  });
});

describe("migrateRoomData", () => {
  it("모양이 깨진 대화·기록 한 줄은 버리고 나머지는 살린다", () => {
    const d = {
      ...oldFixture(),
      chat: [{ id: "m1", seq: 1, at: 1, session: 1, kind: "say", userId: "u", name: "n", role: "pl", text: "ok" }, { nope: 1 }, "text", null, { id: "m2", seq: 2, at: 1, userId: "u", name: "n", text: "t", kind: "whisper" }],
      log: [{ n: 1, at: 1, session: 1, kind: "session", type: "start", text: "세션 1 시작", audience: "all" }, { n: 2, kind: "zzz" }, { n: 3, at: 1, kind: "chat", type: "x", text: "t", audience: [1, 2] }],
      chatSettings: { plWhisper: "yes" },
    };
    const m = migrateRoomData(d);
    expect(m.chat?.map((c) => c.id)).toEqual(["m1"]);
    expect(m.log?.map((e) => e.n)).toEqual([1]);
    expect(m.chatSettings).toEqual({ plWhisper: false, spectatorChat: false, plSelfEdit: true });
  });

  it("더 새로운 번호와 모르는 필드가 있어도 열린다(아는 것만 읽는다)", () => {
    const m = migrateRoomData({ ...oldFixture(), schemaVersion: 99, futureThing: { a: 1 } });
    expect(m.schemaVersion).toBe(ROOM_SCHEMA_VERSION);
    expect((m as unknown as Record<string, unknown>).futureThing).toEqual({ a: 1 });
    expect(Room.fromData({ ...oldFixture(), schemaVersion: 99 }).snapshot(kp).roomId).toBe("fixture-room");
  });

  it("옛 데이터에 배열이 빠져 있어도 열린다", () => {
    const { objects: _o, members: _m, rolls: _r, ...rest } = oldFixture();
    const room = Room.fromData(rest as unknown as RoomData);
    expect(room.snapshot(kp).rolls).toEqual([]);
  });

  it("룸 번호가 없으면 오류다", () => {
    expect(() => migrateRoomData({})).toThrow();
    expect(() => migrateRoomData(null)).toThrow();
  });

  it("저장 뒤 JSON으로 다시 읽으면 같은 데이터가 된다(왕복)", () => {
    const first = Room.fromData(oldFixture()).toData();
    const again = Room.fromData(JSON.parse(JSON.stringify(first)) as RoomData).toData();
    expect(again).toEqual(first);
  });
});
