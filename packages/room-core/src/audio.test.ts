import { describe, expect, it } from "vitest";
import type { ClientCommand } from "@coc-vtt/shared";
import { Room, type Actor, type Out } from "./room";

const kp: Actor = { userId: "kp1", name: "하늘", role: "kp" };
const seo: Actor = { userId: "pl1", name: "윤서하", role: "pl" };
const A1 = "a".repeat(32);
const A2 = "b".repeat(32);

let n = 0;
const cmd = <T extends ClientCommand["type"]>(type: T, data: Extract<ClientCommand, { type: T }>["data"]) => ({ type, data }) as ClientCommand;
const must = (r: ReturnType<Room["handle"]>): Out[] => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
  return r.out;
};
let clock = 1_000;
const setup = () => {
  clock = 1_000;
  const room = new Room("r", { newId: () => `id-${++n}`, rng: () => 0.5, now: () => clock });
  room.join(kp);
  room.join(seo);
  const add = (label: string, kind: "bgm" | "se", assetId: string, volume = 80) => {
    const ev = must(room.handle(kp, cmd("audio.track.add", { label, kind, assetId, volume })))[0]!.event;
    if (ev.type !== "audio.library") throw new Error();
    return ev.data.tracks[ev.data.tracks.length - 1]!;
  };
  return { room, add };
};

describe("음향", () => {
  it("GM만 다루고, 라이브러리는 GM에게만 간다", () => {
    const { room, add } = setup();
    const t = add("괴물의 울음", "se", A1);
    expect(room.handle(seo, cmd("audio.track.add", { label: "x", kind: "bgm", assetId: A1, volume: 50 })).ok).toBe(false);
    expect(room.handle(seo, cmd("audio.play", { trackId: t.id, fadeMs: 0 })).ok).toBe(false);
    expect(room.snapshot(kp).audioLibrary).toHaveLength(1);
    expect(room.snapshot(seo).audioLibrary).toEqual([]);
    const out = must(room.handle(kp, cmd("audio.track.add", { label: "y", kind: "bgm", assetId: A2, volume: 50 })));
    expect(out[0]!.audience.roles).toEqual(["kp"]);
  });

  it("배경음은 서버 시각과 함께 모두에게 가고, 이름은 새지 않는다", () => {
    const { room, add } = setup();
    const t = add("비밀스러운 제목", "bgm", A1, 60);
    clock = 5_000;
    const out = must(room.handle(kp, cmd("audio.play", { trackId: t.id, fadeMs: 1500 })));
    const ev = out[0]!.event;
    if (ev.type !== "audio.play") throw new Error();
    expect(ev.data).toEqual({ assetId: A1, channel: "bgm", volume: 60, loop: true, fadeMs: 1500, startedAt: 5_000 });
    expect(out[0]!.audience.roles).toEqual(expect.arrayContaining(["kp", "pl", "spectator"]));
    expect(JSON.stringify(out)).not.toContain("비밀스러운 제목");
    expect(room.snapshot(seo).bgm).toEqual({ assetId: A1, volume: 60, startedAt: 5_000, fadeMs: 1500 });
    expect(room.snapshot(seo).now).toBe(5_000);
  });

  it("효과음은 한 번 울리고 상태로 남지 않는다. 볼륨을 직접 줄 수 있다", () => {
    const { room, add } = setup();
    const t = add("문 닫히는 소리", "se", A1, 80);
    const out = must(room.handle(kp, cmd("audio.play", { trackId: t.id, volume: 30, fadeMs: 0 })));
    const ev = out[0]!.event;
    if (ev.type !== "audio.play") throw new Error();
    expect(ev.data).toMatchObject({ channel: "se", loop: false, volume: 30 });
    expect(room.snapshot(seo).bgm).toBeNull();
  });

  it("배경음 볼륨을 바꾸고 멈춘다. 흐르는 배경음이 없으면 거절한다", () => {
    const { room, add } = setup();
    const t = add("숲", "bgm", A1);
    expect(room.handle(kp, cmd("audio.volume", { volume: 10 })).ok).toBe(false);
    expect(room.handle(kp, cmd("audio.stop", { fadeMs: 0 })).ok).toBe(false);
    must(room.handle(kp, cmd("audio.play", { trackId: t.id, fadeMs: 0 })));
    must(room.handle(kp, cmd("audio.volume", { volume: 10 })));
    expect(room.snapshot(seo).bgm?.volume).toBe(10);
    const stop = must(room.handle(kp, cmd("audio.stop", { fadeMs: 2000 })));
    expect(stop[0]!.event).toEqual({ type: "audio.stopped", data: { fadeMs: 2000 } });
    expect(room.snapshot(seo).bgm).toBeNull();
  });

  it("없는 음원은 재생도 삭제도 거절하고, 음원 수에는 한도가 있다", () => {
    const { room, add } = setup();
    expect(room.handle(kp, cmd("audio.play", { trackId: "nope", fadeMs: 0 })).ok).toBe(false);
    expect(room.handle(kp, cmd("audio.track.remove", { id: "nope" })).ok).toBe(false);
    for (let i = 0; i < 30; i++) add(`t${i}`, "se", A1);
    expect(room.handle(kp, cmd("audio.track.add", { label: "넘침", kind: "se", assetId: A1, volume: 50 })).ok).toBe(false);
  });

  it("잘못된 파일 id는 프로토콜이 거절한다", async () => {
    const { clientCommandSchema } = await import("@coc-vtt/shared");
    expect(clientCommandSchema.safeParse({ type: "audio.track.add", data: { label: "x", kind: "bgm", assetId: "../x" } }).success).toBe(false);
  });

  it("저장했다 복원해도 라이브러리와 배경음이 남는다", () => {
    const { room, add } = setup();
    const t = add("숲", "bgm", A1);
    must(room.handle(kp, cmd("audio.play", { trackId: t.id, fadeMs: 0 })));
    const back = Room.fromData(room.toData(), { newId: () => `id-${++n}`, rng: () => 0.5, now: () => clock });
    back.join(kp);
    expect(back.snapshot(kp).audioLibrary).toHaveLength(1);
    expect(back.snapshot(kp).bgm?.assetId).toBe(A1);
  });
});

describe("비트 큐의 배경음", () => {
  it("비트에 들어가면 배경음이 흐르고, 효과음 트랙은 연결할 수 없다", () => {
    const { room, add } = setup();
    const bgm = add("숲", "bgm", A1);
    const se = add("문", "se", A2);
    const flow = (data: Partial<Extract<ClientCommand, { type: "flow.beat.upsert" }>["data"]> & { name: string }) =>
      room.handle(kp, cmd("flow.beat.upsert", { kind: "progress", memo: "", handoutIds: [], ...data }));
    expect(flow({ name: "잘못", bgmTrackId: se.id }).ok).toBe(false);
    expect(flow({ name: "없음", bgmTrackId: "nope" }).ok).toBe(false);
    must(flow({ name: "시작", kind: "start" }));
    must(flow({ name: "숲속", bgmTrackId: bgm.id }));
    const beats = room.snapshot(kp).flow!.beats;
    must(room.handle(kp, cmd("session.start", {})));
    const out = must(room.handle(kp, cmd("flow.goto", { beatId: beats.find((b) => b.name === "숲속")!.id })));
    expect(out.some((o) => o.event.type === "audio.play" && o.event.data.assetId === A1)).toBe(true);
    expect(room.snapshot(seo).bgm?.assetId).toBe(A1);
  });

  it("음원을 지우면 비트의 연결도 풀린다", () => {
    const { room, add } = setup();
    const bgm = add("숲", "bgm", A1);
    must(room.handle(kp, cmd("flow.beat.upsert", { name: "숲속", kind: "progress", memo: "", handoutIds: [], bgmTrackId: bgm.id })));
    const out = must(room.handle(kp, cmd("audio.track.remove", { id: bgm.id })));
    expect(out.map((o) => o.event.type)).toEqual(["audio.library", "flow.updated"]);
    expect(room.snapshot(kp).flow!.beats[0]!.bgmTrackId).toBeUndefined();
  });
});

describe("장면 묶음의 배경음", () => {
  it("장면에 묶으면 전환할 때 흐르고, 같은 곡이 흐르면 끊지 않는다. 참가자는 연결을 모른다", () => {
    const { room, add } = setup();
    const bgm = add("숲", "bgm", A1);
    const se = add("문", "se", A2);
    const sc = must(room.handle(kp, cmd("scene.create", { name: "숲" })))[0]!.event;
    if (sc.type !== "scene.added") throw new Error();
    const id = sc.data.id;
    expect(room.handle(seo, cmd("scene.setBgm", { id, trackId: bgm.id })).ok).toBe(false);
    expect(room.handle(kp, cmd("scene.setBgm", { id, trackId: se.id })).ok).toBe(false);
    expect(room.handle(kp, cmd("scene.setBgm", { id: "nope", trackId: bgm.id })).ok).toBe(false);
    must(room.handle(kp, cmd("scene.setBgm", { id, trackId: bgm.id })));
    must(room.handle(kp, cmd("session.start", {})));
    const out = must(room.handle(kp, cmd("scene.activate", { id, transition: "fade" })));
    const play = out.find((o) => o.event.type === "audio.play");
    expect(play?.event.type === "audio.play" && play.event.data.fadeMs).toBe(1500);
    expect(JSON.stringify(out.filter((o) => o.audience.users?.includes("pl1")))).not.toContain("bgmTrackId");
    expect(room.snapshot(seo).scenes.every((s) => !("bgmTrackId" in s))).toBe(true);
    // 다른 장면으로 갔다 와도 같은 곡이 이미 흐르는 장면이면 다시 켜지 않는다
    const other = must(room.handle(kp, cmd("scene.create", { name: "집" })))[0]!.event;
    if (other.type !== "scene.added") throw new Error();
    must(room.handle(kp, cmd("scene.setBgm", { id: other.data.id, trackId: bgm.id })));
    const out2 = must(room.handle(kp, cmd("scene.activate", { id: other.data.id, transition: "cut" })));
    expect(out2.some((o) => o.event.type === "audio.play")).toBe(false);
  });

  it("음원을 지우면 장면의 연결도 풀린다", () => {
    const { room, add } = setup();
    const bgm = add("숲", "bgm", A1);
    const sc = must(room.handle(kp, cmd("scene.create", { name: "숲" })))[0]!.event;
    if (sc.type !== "scene.added") throw new Error();
    must(room.handle(kp, cmd("scene.setBgm", { id: sc.data.id, trackId: bgm.id })));
    must(room.handle(kp, cmd("audio.track.remove", { id: bgm.id })));
    expect(room.snapshot(kp).scenes.find((s) => s.id === sc.data.id)?.bgmTrackId).toBeUndefined();
  });
});

describe("장면·비트의 음악 정지", () => {
  it("'음악 정지'를 묶은 장면으로 가면 흐르던 곡이 페이드로 멈춘다", () => {
    const { room, add } = setup();
    const bgm = add("추격", "bgm", A1);
    must(room.handle(kp, cmd("session.start", {})));
    must(room.handle(kp, cmd("audio.play", { trackId: bgm.id, fadeMs: 0 })));
    const sc = must(room.handle(kp, cmd("scene.create", { name: "조용한 방" })))[0]!.event;
    if (sc.type !== "scene.added") throw new Error();
    must(room.handle(kp, cmd("scene.setBgm", { id: sc.data.id, trackId: "__stop__" })));
    const out = must(room.handle(kp, cmd("scene.activate", { id: sc.data.id, transition: "fade" })));
    const stop = out.find((o) => o.event.type === "audio.stopped");
    expect(stop?.event.type === "audio.stopped" && stop.event.data.fadeMs).toBe(1500);
    expect(room.snapshot(seo).bgm).toBeNull();
  });
  it("흐르는 곡이 없으면 정지 이벤트도 없다", () => {
    const { room } = setup();
    must(room.handle(kp, cmd("session.start", {})));
    const sc = must(room.handle(kp, cmd("scene.create", { name: "방" })))[0]!.event;
    if (sc.type !== "scene.added") throw new Error();
    must(room.handle(kp, cmd("scene.setBgm", { id: sc.data.id, trackId: "__stop__" })));
    const out = must(room.handle(kp, cmd("scene.activate", { id: sc.data.id, transition: "cut" })));
    expect(out.some((o) => o.event.type === "audio.stopped")).toBe(false);
  });
});
