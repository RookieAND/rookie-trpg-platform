import { describe, expect, it } from "vitest";
import { MAX_AUDIO_TRACKS, MAX_MADNESS_ENTRIES } from "@coc-vtt/shared";
import { validateScenario, type ScenarioFile } from "./scenario-validate";

const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WAVE"), Buffer.alloc(8)]);
const files: Record<string, Buffer> = { "a/bgm.wav": wav, "a/se.wav": wav, "a/text.wav": Buffer.from("not audio at all"), "a/empty.wav": Buffer.alloc(0) };
const read = (p: string) => files[p] ?? null;

const base = (): ScenarioFile => ({
  format: "roll-and-call-scenario",
  version: 1,
  roomName: "시험",
  scenes: [{ key: "s1", name: "방", start: true, bgm: "bgm1" }],
  tokens: [],
  characters: [],
  handouts: [{ key: "h1", title: "메모", body: "...", visibleTo: "all" }],
  beats: [{ key: "b1", name: "시작", kind: "start", scene: "s1", handouts: ["h1"], memo: "", bgm: "bgm1" }],
  branches: [],
  madnessTable: ["도망쳐요"],
  audio: [
    { key: "bgm1", label: "잔잔한 곡", kind: "bgm", file: "a/bgm.wav" },
    { key: "se1", label: "문 소리", kind: "se", file: "a/se.wav" },
  ],
});

describe("validateScenario", () => {
  it("올바른 시나리오는 통과해요", () => expect(validateScenario(base(), read)).toEqual([]));
  it("audio와 madnessTable은 없어도 돼요", () => {
    const sc = base();
    delete sc.audio;
    delete sc.madnessTable;
    sc.scenes[0]!.bgm = undefined;
    sc.beats[0]!.bgm = undefined;
    expect(validateScenario(sc, read)).toEqual([]);
  });
  it("광기표 개수·길이·빈 줄을 막아요", () => {
    const sc = base();
    sc.madnessTable = Array.from({ length: MAX_MADNESS_ENTRIES + 1 }, () => "x");
    expect(validateScenario(sc, read).join()).toContain("madnessTable은");
    sc.madnessTable = ["가".repeat(121), "  "];
    const e = validateScenario(sc, read);
    expect(e.some((m) => m.includes("madnessTable[0]"))).toBe(true);
    expect(e.some((m) => m.includes("madnessTable[1]"))).toBe(true);
  });
  it("없는 파일, 빈 파일, 오디오가 아닌 파일을 막아요", () => {
    const sc = base();
    sc.audio = [
      { key: "x1", label: "a", kind: "se", file: "a/none.wav" },
      { key: "x2", label: "a", kind: "se", file: "a/text.wav" },
      { key: "x3", label: "a", kind: "se", file: "a/empty.wav" },
    ];
    sc.scenes[0]!.bgm = undefined;
    sc.beats[0]!.bgm = undefined;
    const e = validateScenario(sc, read);
    expect(e).toHaveLength(3);
    expect(e[0]).toContain("파일이 없어요");
    expect(e[1]).toContain("형식을 알 수 없어요");
    expect(e[2]).toContain("비어 있어요");
  });
  it("10MB를 넘는 파일을 막아요", () => {
    const big = Buffer.concat([wav, Buffer.alloc(10 * 1024 * 1024)]);
    expect(validateScenario(base(), (p) => (p === "a/bgm.wav" ? big : wav)).join()).toContain("너무 커요");
  });
  it("절대 경로와 바깥 경로를 막아요", () => {
    const sc = base();
    sc.audio![0]!.file = "/etc/passwd";
    sc.audio![1]!.file = "../x.wav";
    expect(validateScenario(sc, () => wav).filter((m) => m.includes("상대 경로"))).toHaveLength(2);
  });
  it("트랙 수 상한, key 중복, 잘못된 kind·label을 막아요", () => {
    const sc = base();
    sc.audio = Array.from({ length: MAX_AUDIO_TRACKS + 1 }, (_, i) => ({ key: `k${i}`, label: "a", kind: "se" as const, file: "a/se.wav" }));
    sc.scenes[0]!.bgm = undefined;
    sc.beats[0]!.bgm = undefined;
    expect(validateScenario(sc, read).join()).toContain("audio는");
    sc.audio = [
      { key: "d", label: "a", kind: "se", file: "a/se.wav" },
      { key: "d", label: "a", kind: "se", file: "a/se.wav" },
      { key: "e", label: "", kind: "x" as never, file: "a/se.wav" },
    ];
    const e = validateScenario(sc, read).join("\n");
    expect(e).toContain("겹쳐요");
    expect(e).toContain("label");
    expect(e).toContain("kind");
  });
  it("없는 key와 효과음을 bgm으로 쓰는 것을 막아요", () => {
    const sc = base();
    sc.scenes[0]!.bgm = "nope";
    sc.beats[0]!.bgm = "se1";
    const e = validateScenario(sc, read);
    expect(e[0]).toContain('"nope"');
    expect(e[1]).toContain("효과음");
  });
  it("장면·핸드아웃·비트 참조 오류를 모아서 알려 줘요", () => {
    const sc = base();
    sc.tokens.push({ scene: "zz", kind: "prop", name: "상자", x: 0, y: 0, layer: "object", visibleTo: "all" });
    sc.beats[0]!.handouts = ["hh"];
    sc.branches.push({ from: "b1", to: "b9", label: "가요" });
    expect(validateScenario(sc, read)).toHaveLength(3);
  });
});
