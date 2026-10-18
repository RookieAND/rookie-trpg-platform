import { describe, expect, it } from "vitest";
import { SAMPLE_SCENARIO } from "@coc-vtt/shared";
import { importedText, previewLocal, safeFileName } from "./preview";

describe("previewLocal", () => {
  it("예시 파일은 통과하고 개수를 보여 줘요", () => {
    const r = previewLocal(JSON.stringify(SAMPLE_SCENARIO));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.counts.scenes).toBe(2);
      expect(r.line).toContain("장면 2");
      expect(r.kind).toBe("scenario");
    }
  });
  it("깨진 글과 빈 글, 항목 오류를 위치와 함께 알려요", () => {
    expect(previewLocal("  ")).toEqual({ ok: false, errors: ["파일이 비어 있어요."] });
    const broken = previewLocal("{ nope");
    expect(broken.ok).toBe(false);
    const bad = previewLocal(JSON.stringify({ ...SAMPLE_SCENARIO, tokens: [{ scene: "없는장면", kind: "prop", name: "상자", x: 1, y: 1 }] }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join("\n")).toContain("없는장면");
  });
});

describe("파일 이름과 안내 문구", () => {
  it("파일 이름에 못 쓰는 글자를 바꿔요", () => {
    expect(safeFileName("저택: 1/2 *밤*", "백업")).toBe("저택_1_2_밤-백업.json");
    expect(safeFileName("///", "x")).toBe("room-x.json");
  });
  it("가져온 결과 문구", () => {
    expect(importedText("장면 2", 0)).toBe("가져왔어요 · 장면 2");
    expect(importedText("장면 2", 3)).toBe("가져왔어요 · 장면 2 (주의 3건)");
  });
});
