import { describe, expect, it } from "vitest";
import type { ClientCommand } from "@coc-vtt/shared";
import { KP_BLOCKED_WHILE_PAUSED, Room, type Actor, type Out } from "./room";

const kp: Actor = { userId: "kp1", name: "하늘", role: "kp" };
const seo: Actor = { userId: "pl1", name: "윤서하", role: "pl" };
const spec: Actor = { userId: "sp1", name: "구경꾼", role: "spectator" };

let n = 0;
const cmd = <T extends ClientCommand["type"]>(type: T, data: Extract<ClientCommand, { type: T }>["data"]) =>
  ({ type, data }) as ClientCommand;

function must(r: ReturnType<Room["handle"]>): Out[] {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.out;
}
const types = (outs: Out[]) => outs.map((o) => o.event.type);

const started = (opts: ConstructorParameters<typeof Room>[1] = {}) => {
  const room = new Room("r", { newId: () => `id-${++n}`, ...opts });
  for (const a of [kp, seo, spec]) room.join(a);
  must(room.handle(kp, cmd("session.start", {})));
  return room;
};

const sheetData = {
  name: "윤서하",
  age: 27,
  occupation: "기자",
  characteristics: { STR: 50, CON: 60, SIZ: 60, DEX: 60, APP: 50, INT: 70, POW: 60, EDU: 70 },
  luck: 55,
  skills: [{ name: "심리학", value: 40, grown: false }],
};

describe("GM 연결 유예", () => {
  it("GM이 나가면 끊긴 시각을 알리고 정지하지 않는다", () => {
    const room = started({ now: () => 777 });
    const outs = room.leave("kp1");
    expect(types(outs)).toEqual(["presence", "kp.away"]);
    expect(outs[1]!.event).toEqual({ type: "kp.away", data: { since: 777 } });
    expect(room.sessionStatus).toBe("ACTIVE");
    expect(room.kpAway).toBe(777);
    expect(room.snapshot(seo).kpAwaySince).toBe(777);
    // 유예 중에도 PL은 계속 할 수 있다
    expect(room.handle(seo, cmd("roll.request", { expr: "1d100", secret: false })).ok).toBe(true);
  });

  it("유예 안에 GM이 돌아오면 정지 없이 계속된다", () => {
    const room = started();
    room.leave("kp1");
    const back = room.join(kp);
    expect(types(back)).toEqual(["presence", "kp.back"]);
    expect(room.kpAway).toBeNull();
    expect(room.sessionStatus).toBe("ACTIVE");
    // 늦게 온 타이머는 아무 일도 하지 않는다
    expect(room.expireKpAway()).toEqual([]);
    expect(room.sessionStatus).toBe("ACTIVE");
  });

  it("PL과 관전자가 나가도 유예는 시작되지 않는다", () => {
    const room = started();
    room.leave("pl1");
    room.leave("sp1");
    expect(room.kpAway).toBeNull();
  });

  it("세션이 진행 중이 아니면 GM이 나가도 유예하지 않는다", () => {
    const room = new Room("r", { newId: () => `id-${++n}` });
    room.join(kp);
    expect(types(room.leave("kp1"))).toEqual(["presence"]);
  });

  it("유예가 끝나면 자동 정지(kp_disconnected)하고, GM이 돌아오면 자동 재개한다", () => {
    const room = started();
    room.leave("kp1");
    const paused = room.expireKpAway();
    expect(paused[0]!.event).toEqual({ type: "session.paused", data: { reason: "kp_disconnected" } });
    expect(room.snapshot(seo)).toMatchObject({ sessionStatus: "PAUSED", pauseReason: "kp_disconnected", kpAwaySince: null });
    const back = room.join(kp);
    expect(types(back)).toEqual(["presence", "session.resumed"]);
    expect(room.sessionStatus).toBe("ACTIVE");
    expect(room.snapshot(seo).pauseReason).toBeNull();
  });

  it("GM이 직접 누른 정지는 돌아와도 자동 재개하지 않는다", () => {
    const room = started();
    must(room.handle(kp, cmd("session.pause", {})));
    room.leave("kp1");
    expect(room.kpAway).toBeNull();
    room.join(kp);
    expect(room.sessionStatus).toBe("PAUSED");
    expect(room.snapshot(kp).pauseReason).toBe("kp_request");
  });

  it("세션을 끝내면 유예와 정지 사유가 사라진다", () => {
    const room = started();
    must(room.handle(kp, cmd("session.pause", {})));
    must(room.handle(kp, cmd("session.end", {})));
    expect(room.snapshot(kp)).toMatchObject({ sessionStatus: "IDLE", pauseReason: null, kpAwaySince: null });
  });
});

describe("저장과 복원", () => {
  it("자동 정지 사유를 저장하고, 옛 데이터(사유 없음)의 정지는 GM이 누른 정지로 본다", () => {
    const room = started();
    room.leave("kp1");
    room.expireKpAway();
    const data = JSON.parse(JSON.stringify(room.toData()));
    expect(data.pauseReason).toBe("kp_disconnected");
    const restored = Room.fromData(data);
    expect(restored.snapshot(kp).pauseReason).toBe("kp_disconnected");
    restored.join(kp);
    expect(restored.sessionStatus).toBe("ACTIVE");

    delete data.pauseReason;
    const legacy = Room.fromData(data);
    legacy.join(kp);
    expect(legacy.sessionStatus).toBe("PAUSED");
  });

  it("유예 중에 저장돼 다시 켜지면 자동 정지로 복원되고 GM이 오면 재개된다", () => {
    const room = started();
    room.leave("kp1"); // 유예 중(ACTIVE)
    const restored = Room.fromData(JSON.parse(JSON.stringify(room.toData())));
    expect(restored.snapshot(seo)).toMatchObject({ sessionStatus: "PAUSED", pauseReason: "kp_disconnected", kpAwaySince: null });
    restored.join(kp);
    expect(restored.sessionStatus).toBe("ACTIVE");
  });

  it("GM이 직접 멈춘 세션은 다시 켜도 직접 정지로 남는다", () => {
    const room = started();
    must(room.handle(kp, cmd("session.pause", {})));
    const restored = Room.fromData(JSON.parse(JSON.stringify(room.toData())));
    restored.join(kp);
    expect(restored.sessionStatus).toBe("PAUSED");
  });

  it("기존 저장 데이터(pauseReason 없음, ACTIVE)도 읽힌다", () => {
    const data = JSON.parse(JSON.stringify(started().toData()));
    delete data.pauseReason;
    expect(Room.fromData(data).sessionStatus).toBe("PAUSED");
  });
});

describe("일시정지 중 허용 명령", () => {
  const paused = () => {
    const room = started();
    must(room.handle(kp, cmd("character.add", { ...sheetData, ownerId: "pl1" } as never)));
    must(room.handle(kp, cmd("session.pause", {})));
    return room;
  };
  const charId = (room: Room) => room.snapshot(kp).characters[0]!.id;

  it("PL의 명령은 모두 막힌다", () => {
    const room = paused();
    for (const c of [cmd("roll.request", { expr: "1d100", secret: false }), cmd("sheet.patch", { characterId: charId(room), ops: [{ path: "notes", value: "x" }] })]) {
      expect(room.handle(seo, c)).toMatchObject({ ok: false, code: "paused" });
    }
  });

  it("GM은 장면·토큰·시트·핸드아웃·흐름·안개·음향을 고칠 수 있다", () => {
    const room = paused();
    const sceneId = must(room.handle(kp, cmd("scene.create", { name: "지하실" }))).map((o) => o.event).find((e) => e.type === "scene.added");
    expect(sceneId).toBeTruthy();
    expect(room.handle(kp, cmd("object.add", { kind: "token", name: "NPC", x: 1, y: 1, layer: "object", visibleTo: "all" })).ok).toBe(true);
    expect(room.handle(kp, cmd("sheet.patch", { characterId: charId(room), ops: [{ path: "hp", delta: -3 }] })).ok).toBe(true);
    expect(room.handle(kp, cmd("handout.create", { title: "편지", body: "안녕", visibleTo: "gm" } as never)).ok).toBe(true);
    expect(room.handle(kp, cmd("scene.fog", { id: room.snapshot(kp).activeSceneId, enabled: true })).ok).toBe(true);
    expect(room.handle(kp, cmd("flow.beat.upsert", { name: "도입", kind: "progress", memo: "", handoutIds: [] } as never)).ok).toBe(true);
    expect(room.handle(kp, cmd("settings.madness", { entries: ["공포"] })).ok).toBe(true);
    expect(room.handle(kp, cmd("san.newDay", { characterId: charId(room) })).ok).toBe(true);
    expect(room.sessionStatus).toBe("PAUSED");
  });

  it("GM도 판정·전투·장면 전환·핸드아웃 펼치기는 막힌다", () => {
    const room = paused();
    const sceneId = room.snapshot(kp).activeSceneId;
    const blocked: ClientCommand[] = [
      cmd("roll.request", { expr: "1d100", secret: true }),
      cmd("san.check", { characterId: charId(room), loss: "0/1d6" }),
      cmd("initiative.start", {}),
      cmd("scene.activate", { id: sceneId, transition: "cut" }),
      cmd("handout.show", { id: "x" }),
      cmd("flow.goto", { beatId: "x" }),
    ];
    for (const c of blocked) {
      expect(room.handle(kp, c), c.type).toMatchObject({ ok: false, code: "paused" });
      expect(KP_BLOCKED_WHILE_PAUSED.has(c.type)).toBe(true);
    }
  });

  it("이어하기를 하면 막혔던 명령이 다시 된다", () => {
    const room = paused();
    must(room.handle(kp, cmd("session.resume", {})));
    expect(room.handle(kp, cmd("roll.request", { expr: "1d100", secret: true })).ok).toBe(true);
  });
});
