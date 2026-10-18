import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BACKUP_FORMAT, SAMPLE_SCENARIO, SCENARIO_FORMAT, classifyRef, countScenario, countsLine, parseScenario, parseScenarioText, splitNoteTitle } from "./index";

const minimal = () => ({
  format: SCENARIO_FORMAT,
  version: 1,
  roomName: "시험",
  scenes: [{ key: "s1", name: "방" }],
  tokens: [],
  characters: [],
  handouts: [],
  beats: [],
  branches: [],
});
const errs = (raw: unknown) => {
  const r = parseScenario(raw);
  if (r.ok) throw new Error("통과하면 안 돼요");
  return r.errors.map((e) => `${e.where}: ${e.message}`);
};

describe("parseScenario", () => {
  it("예전 버전 1 파일도 그대로 읽는다(새 필드는 모두 선택)", () => {
    const r = parseScenario({
      ...minimal(),
      tokens: [{ scene: "s1", kind: "prop", name: "상자", x: 1, y: 2, layer: "object", visibleTo: "all" }],
      characters: [{ name: "관리인", age: 50, occupation: "관리인", characteristics: { STR: 1, CON: 1, SIZ: 1, DEX: 1, APP: 1, INT: 1, POW: 1, EDU: 1 }, skills: [{ name: "듣기", value: 60 }] }],
      handouts: [{ key: "h", title: "[KP] 비밀", body: "x", visibleTo: "gm" }],
      audio: [{ key: "a", label: "곡", kind: "bgm", file: "a.mp3" }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.tokens[0]).toMatchObject({ layer: "object", visibleTo: "all" });
  });

  it("빈 항목은 기본값으로 채운다", () => {
    const r = parseScenario({ format: SCENARIO_FORMAT, version: 2, roomName: "x", scenes: [{ key: "a", name: "A" }] });
    expect(r.ok && r.doc).toMatchObject({ tokens: [], characters: [], handouts: [], beats: [], branches: [] });
  });

  it("문서(docs/scenario-format.md)의 예시와 '예시 받기' 파일은 같은 내용이고 통과한다", () => {
    const md = readFileSync(new URL("../../../docs/scenario-format.md", import.meta.url), "utf8");
    const block = /```json\n([\s\S]*?)\n```/.exec(md)?.[1];
    expect(block).toBeTruthy();
    expect(JSON.parse(block!)).toEqual(JSON.parse(JSON.stringify(SAMPLE_SCENARIO)));
    const r = parseScenarioText(JSON.stringify(SAMPLE_SCENARIO));
    expect(r.ok).toBe(true);
    if (r.ok) expect(countsLine(countScenario(r.doc))).toContain("장면 2");
  });

  it("틀린 곳마다 위치와 이유를 한국어로 알려 준다", () => {
    const raw = {
      ...minimal(),
      tokens: [{ scene: "s1", kind: "token", name: "낡은 상자", x: "가운데", y: 1 }, { scene: "없는장면", kind: "box", name: "", x: 1, y: 2 }],
      handouts: [{ key: "bad key!", title: "제목", visibleTo: "all" }],
    };
    const e = errs(raw);
    expect(e).toContain("tokens[0] (낡은 상자) · x: 숫자 값이어야 해요.");
    expect(e.some((m) => m.startsWith("tokens[1]") && m.includes("kind") && m.includes("중 하나여야"))).toBe(true);
    expect(e.some((m) => m.startsWith("tokens[1]") && m.endsWith("name: 비어 있어요."))).toBe(true);
    expect(e.some((m) => m.startsWith("handouts[0]") && m.includes("key는 영문"))).toBe(true);
    expect(e.join("\n")).not.toMatch(/Expected|Required|received/);
  });

  it("참조 오류(없는 장면·시트·비트·핸드아웃, 효과음 배경음, GM 전용 노트의 비트 연결)를 잡는다", () => {
    const raw = {
      ...minimal(),
      tokens: [{ scene: "x", kind: "token", name: "토큰", x: 1, y: 1, character: "zz" }],
      handouts: [{ key: "n", title: "[GM] 메모", visibleTo: "gm" }],
      beats: [{ key: "b", name: "비트", kind: "start", scene: "y", handouts: ["n", "q"], bgm: "fx" }],
      branches: [{ from: "b", to: "c", label: "간다" }],
      audio: [{ key: "fx", label: "소리", kind: "se", assetId: "a".repeat(32) }],
    };
    const e = errs(raw).join("\n");
    expect(e).toContain('scene "x"이 scenes에 없어요');
    expect(e).toContain('character "zz"가 characters에 없어요');
    expect(e).toContain('scene "y"이 scenes에 없어요');
    expect(e).toContain('handouts "q"가 handouts에 없어요');
    expect(e).toContain("GM 전용 노트");
    expect(e).toContain("효과음(se)이라 배경음으로 쓸 수 없어요");
    expect(e).toContain('to "c"이 beats에 없어요');
  });

  it("key 겹침, 음원 소스 없음, 광기표 길이를 잡는다", () => {
    const e = errs({ ...minimal(), scenes: [{ key: "a", name: "A" }, { key: "a", name: "B" }], audio: [{ key: "z", label: "곡", kind: "bgm" }], madnessTable: ["  ", "가".repeat(121)] }).join("\n");
    expect(e).toContain('key "a"가 겹쳐요');
    expect(e).toContain("file, assetId, data 중 하나가 필요해요");
    expect(e).toContain("madnessTable[0]");
    expect(e).toContain("madnessTable[1]");
  });

  it("다른 형식·새 버전·깨진 JSON을 알려 준다", () => {
    expect(errs({ ...minimal(), format: "other" })[0]).toContain("roll-and-call-scenario");
    expect(errs({ ...minimal(), version: 9 })[0]).toContain("더 새로운 버전");
    expect(errs({ ...minimal(), format: BACKUP_FORMAT, version: 2 })[0]).toContain("더 새로운 버전");
    const bad = parseScenarioText("{ 아님");
    expect(!bad.ok && bad.errors[0]!.message).toContain("JSON으로 읽을 수 없어요");
    expect(errs([])[0]).toContain("시나리오 파일이 아니에요");
    expect(parseScenarioText("﻿" + JSON.stringify(minimal())).ok).toBe(true);
  });

  it("품은 데이터가 너무 많거나 크면 막는다", () => {
    const big = "data:image/png;base64," + "A".repeat(2_000_000);
    const raw = { ...minimal(), scenes: Array.from({ length: 30 }, (_, i) => ({ key: `s${i}`, name: `장면 ${i}`, background: big })) };
    expect(errs(raw).join("\n")).toContain("너무 커요");
  });
});

describe("보조 함수", () => {
  it("이미지 참조를 id·데이터·경로로 가른다", () => {
    expect(classifyRef("a".repeat(32))).toEqual({ kind: "id", id: "a".repeat(32) });
    expect(classifyRef("data:image/png;base64,AAAA")).toEqual({ kind: "data", base64: "AAAA" });
    expect(classifyRef("img/a.png")).toEqual({ kind: "file", path: "img/a.png" });
  });
  it("[KP]/[GM] 머리말은 GM 전용 노트로 본다", () => {
    expect(splitNoteTitle("[KP] 비밀")).toEqual({ title: "비밀", kpOnly: true });
    expect(splitNoteTitle("[gm]메모")).toEqual({ title: "메모", kpOnly: true });
    expect(splitNoteTitle("그냥 제목")).toEqual({ title: "그냥 제목", kpOnly: false });
  });
});
