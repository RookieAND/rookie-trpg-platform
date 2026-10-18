import { describe, expect, it } from "vitest";
import { parseScenarioText } from "@coc-vtt/shared";
import { inlineLocalFiles } from "./scenario-local";

const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WAVE"), Buffer.alloc(8)]);
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const files: Record<string, Buffer> = { "a/bgm.wav": wav, "i/map.png": png, "a/text.wav": Buffer.from("not audio at all"), "a/empty.wav": Buffer.alloc(0), "i/big.png": Buffer.concat([png, Buffer.alloc(3 * 1024 * 1024)]) };
const read = (p: string) => files[p] ?? null;

const doc = (over: object = {}) => {
  const r = parseScenarioText(
    JSON.stringify({
      format: "roll-and-call-scenario",
      version: 2,
      roomName: "시험",
      scenes: [{ key: "s1", name: "방", start: true, background: "i/map.png", bgm: "bgm1" }],
      audio: [{ key: "bgm1", label: "곡", kind: "bgm", file: "a/bgm.wav" }],
      ...over,
    }),
  );
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.doc;
};

describe("inlineLocalFiles", () => {
  it("이미지·오디오 경로를 데이터 주소로 바꿔요", () => {
    const r = inlineLocalFiles(doc(), read);
    expect(r.errors).toEqual([]);
    expect(r.doc.scenes[0]!.background).toMatch(/^data:image\/png;base64,/);
    expect(r.doc.audio![0]!.data).toMatch(/^data:audio\/wav;base64,/);
    expect(r.doc.audio![0]!.file).toBeUndefined();
  });
  it("없는 파일·잘못된 형식·빈 파일·큰 파일·밖으로 나가는 경로를 모두 알려요", () => {
    const e = inlineLocalFiles(
      doc({ scenes: [{ key: "s1", name: "방", background: "i/none.png" }, { key: "s2", name: "둘", background: "i/big.png" }, { key: "s3", name: "셋", background: "../x.png" }], audio: [{ key: "a1", label: "가", kind: "bgm", file: "a/text.wav" }, { key: "a2", label: "나", kind: "se", file: "a/empty.wav" }] }),
      read,
    ).errors.join("\n");
    expect(e).toContain("파일이 없어요");
    expect(e).toContain("너무 커요");
    expect(e).toContain("상대 경로");
    expect(e).toContain("형식을 알 수 없어요");
    expect(e).toContain("비어 있어요");
  });
  it("id와 데이터 주소는 그대로 둬요", () => {
    const id = "a".repeat(32);
    const r = inlineLocalFiles(doc({ scenes: [{ key: "s1", name: "방", background: id }], audio: undefined }), read);
    expect(r.doc.scenes[0]!.background).toBe(id);
  });
});
