import { describe, expect, it } from "vitest";
import type { ClientCommand } from "@coc-vtt/shared";
import { inAudience, Room, type Actor, type Out } from "./room";

const kp: Actor = { userId: "kp1", name: "하늘", role: "kp" };
const seo: Actor = { userId: "pl1", name: "윤서하", role: "pl" };
const han: Actor = { userId: "pl2", name: "한도윤", role: "pl" };
const spec: Actor = { userId: "sp1", name: "구경꾼", role: "spectator" };

let n = 0;
const cmd = <T extends ClientCommand["type"]>(type: T, data: Extract<ClientCommand, { type: T }>["data"]) =>
  ({ type, data }) as ClientCommand;

const setup = (start = true) => {
  const room = new Room("r", { newId: () => `h-${++n}` });
  for (const a of [kp, seo, han, spec]) room.join(a);
  if (start) room.handle(kp, cmd("session.start", {}));
  return room;
};

const must = (r: ReturnType<Room["handle"]>): Out[] => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.out;
};
const toWho = (outs: Out[], a: Actor) => outs.filter((o) => inAudience(o.audience, a)).map((o) => o.event.type);

const create = (room: Room, visibleTo: "gm" | "all" | string[] = "gm") => {
  const outs = must(room.handle(kp, cmd("handout.create", { title: "낡은 편지", body: "비밀 내용", visibleTo })));
  const id = (outs[0]!.event as { data: { id: string } }).data.id;
  return { outs, id };
};

describe("핸드아웃", () => {
  it("초안(gm)은 KP만 받는다", () => {
    const { outs } = create(setup());
    expect(toWho(outs, kp)).toEqual(["handout.added"]);
    for (const a of [seo, han, spec]) expect(toWho(outs, a)).toEqual([]);
  });

  it("전원 공개하면 모두 받는다", () => {
    const { outs } = create(setup(), "all");
    for (const a of [kp, seo, han, spec]) expect(toWho(outs, a)).toEqual(["handout.added"]);
  });

  it("특정 PL에게만 공개할 수 있다", () => {
    const { outs } = create(setup(), ["pl1"]);
    expect(toWho(outs, seo)).toEqual(["handout.added"]);
    expect(toWho(outs, han)).toEqual([]);
    expect(toWho(outs, spec)).toEqual([]);
  });

  it("공개 범위를 바꾸면 새로 보이는 사람은 added, 계속 보이는 사람은 updated, 가려진 사람은 removed", () => {
    const room = setup();
    const { id } = create(room, ["pl1"]);
    const outs = must(room.handle(kp, cmd("handout.update", { id, visibleTo: ["pl2"] })));
    expect(toWho(outs, han)).toEqual(["handout.added"]);
    expect(toWho(outs, seo)).toEqual(["handout.removed"]);
    expect(toWho(outs, kp)).toEqual(["handout.updated"]);
  });

  it("내용 수정은 보고 있는 사람에게 updated로 간다(rev 증가)", () => {
    const room = setup();
    const { id } = create(room, "all");
    const outs = must(room.handle(kp, cmd("handout.update", { id, body: "고친 내용" })));
    const ev = outs.find((o) => inAudience(o.audience, seo))!.event;
    expect(ev).toMatchObject({ type: "handout.updated", data: { body: "고친 내용", rev: 1 } });
  });

  it("지우면 보던 사람에게 removed가 간다", () => {
    const room = setup();
    const { id } = create(room, "all");
    const outs = must(room.handle(kp, cmd("handout.remove", { id })));
    expect(toWho(outs, seo)).toEqual(["handout.removed"]);
    expect(room.snapshot(seo).handouts).toEqual([]);
  });

  it("PL과 관전자는 만들거나 고치거나 지울 수 없다", () => {
    const room = setup();
    const { id } = create(room, "all");
    for (const a of [seo, spec]) {
      expect(room.handle(a, cmd("handout.create", { title: "x", body: "", visibleTo: "all" }))).toMatchObject({ ok: false, code: "forbidden" });
      expect(room.handle(a, cmd("handout.update", { id, body: "x" }))).toMatchObject({ ok: false, code: "forbidden" });
      expect(room.handle(a, cmd("handout.remove", { id }))).toMatchObject({ ok: false, code: "forbidden" });
    }
  });

  it("세션 시작 전에도 KP는 미리 준비할 수 있다", () => {
    expect(setup(false).handle(kp, cmd("handout.create", { title: "준비", body: "", visibleTo: "gm" })).ok).toBe(true);
  });

  it("snapshot은 볼 수 있는 것만 담고, 저장·복원 뒤에도 유지된다", () => {
    const room = setup();
    create(room, "gm");
    create(room, "all");
    create(room, ["pl2"]);
    expect(room.snapshot(kp).handouts).toHaveLength(3);
    expect(room.snapshot(seo).handouts).toHaveLength(1);
    expect(room.snapshot(han).handouts).toHaveLength(2);
    const restored = Room.fromData(room.toData());
    expect(restored.snapshot(han).handouts).toHaveLength(2);
    const { handouts: _drop, ...old } = room.toData();
    expect(Room.fromData(old).snapshot(kp).handouts).toEqual([]);
  });

  describe("펼쳐 보이기", () => {
    const show = (room: Room, id: string, who: Actor = kp) => room.handle(who, cmd("handout.show", { id }));

    it("펼치기는 볼 수 있는 사람에게만 가고, 버퍼에는 남지 않는다", () => {
      const room = setup();
      const { id } = create(room, ["pl1"]);
      const seqBefore = room.currentSeq;
      const outs = must(show(room, id));
      expect(toWho(outs, seo)).toEqual(["handout.shown"]);
      expect(toWho(outs, han)).toEqual([]);
      expect(toWho(outs, kp)).toEqual([]);
      expect(room.currentSeq).toBe(seqBefore);
    });

    it("초안은 펼칠 수 없고, KP가 아니면 펼칠 수 없다", () => {
      const room = setup();
      const draft = create(room, "gm").id;
      expect(show(room, draft)).toMatchObject({ ok: false, code: "bad_message" });
      const open = create(room, "all").id;
      expect(show(room, open, seo)).toMatchObject({ ok: false, code: "forbidden" });
      expect(show(room, "nope")).toMatchObject({ ok: false, code: "not_found" });
    });
  });

  describe("KP 전용 노트", () => {
    const note = (room: Room) => {
      const outs = must(room.handle(kp, cmd("handout.create", { title: "시나리오의 진상", body: "범인은 이웃", visibleTo: "all", kpOnly: true })));
      return { outs, id: (outs[0]!.event as { data: { id: string } }).data.id };
    };

    it("공개 범위를 all로 만들어도 KP만 받는다", () => {
      const { outs } = note(setup());
      expect(toWho(outs, kp)).toEqual(["handout.added"]);
      for (const a of [seo, han, spec]) expect(toWho(outs, a)).toEqual([]);
    });

    it("공개 범위를 바꾸려 하면 거절하고, 펼쳐 보이기도 안 된다", () => {
      const room = setup();
      const { id } = note(room);
      expect(room.handle(kp, cmd("handout.update", { id, visibleTo: "all" })).ok).toBe(false);
      expect(room.handle(kp, cmd("handout.show", { id })).ok).toBe(false);
    });

    it("비트에 붙이거나 분기 조건으로 쓸 수 없다", () => {
      const room = setup();
      const { id } = note(room);
      expect(room.handle(kp, cmd("flow.beat.upsert", { name: "도입", kind: "start", memo: "", handoutIds: [id] })).ok).toBe(false);
      const a = must(room.handle(kp, cmd("flow.beat.upsert", { name: "A", kind: "start", memo: "", handoutIds: [] })));
      expect(a.length).toBeGreaterThan(0);
    });

    it("KP 전용을 풀면 일반 초안이 되어 다시 공개할 수 있다", () => {
      const room = setup();
      const { id } = note(room);
      must(room.handle(kp, cmd("handout.update", { id, kpOnly: false })));
      const outs = must(room.handle(kp, cmd("handout.update", { id, visibleTo: "all" })));
      expect(toWho(outs, seo)).toEqual(["handout.added"]);
    });

    it("스냅샷에서도 PL에게는 빠진다", () => {
      const room = setup();
      note(room);
      expect(room.snapshot(seo).handouts).toHaveLength(0);
      expect(room.snapshot(kp).handouts).toHaveLength(1);
    });
  });
});
