import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { contrast, over, parseColor, rootTokens, type Rgb } from "@/shared/lib/contrast";

const css = readFileSync(join(__dirname, "globals.css"), "utf8");
const t = rootTokens(css);
const rgb = (name: string): Rgb => {
  const v = t[name];
  if (!v) throw new Error(`${name} 토큰이 없어요`);
  return parseColor(v).rgb;
};
const white: Rgb = [255, 255, 255];
const surfaces = ["--bg", "--panel", "--panel-2", "--panel-3"] as const;
/** 입력 칸 배경: 흰색 3%를 면 위에 올린 색 */
const inputBg = (surface: string) => over("rgba(255,255,255,.03)", rgb(surface));

describe("색 토큰 대비(WCAG)", () => {
  it("파서와 계산이 맞아요", () => {
    expect(contrast([0, 0, 0], white)).toBeCloseTo(21, 0);
    expect(parseColor("rgba(255,255,255,.38)").alpha).toBeCloseTo(0.38);
  });
  it("본문·보조·흐린 글은 모든 면에서 4.5:1 이상", () => {
    for (const s of surfaces) {
      expect(contrast(rgb("--text"), rgb(s))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(rgb("--text-2"), rgb(s))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(rgb("--muted"), rgb(s)), `muted/${s}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("강조·경고 글자색이 배경에서 4.5:1 이상", () => {
    for (const c of ["--accent", "--amber", "--danger", "--ok"]) expect(contrast(rgb(c), rgb("--bg")), c).toBeGreaterThanOrEqual(4.5);
  });
  it("기본 버튼과 눌렀을 때 버튼의 흰 글자가 4.5:1 이상", () => {
    expect(contrast(white, rgb("--primary"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(white, rgb("--primary-hover"))).toBeGreaterThanOrEqual(4.5);
  });
  it("자리표시자 글이 입력 칸 배경에서 4.5:1 이상", () => {
    for (const s of ["--panel", "--panel-2", "--panel-3"]) expect(contrast(rgb("--placeholder"), inputBg(s)), `placeholder/${s}`).toBeGreaterThanOrEqual(4.5);
  });
  it("입력 칸 테두리가 배경에서 3:1 이상(비텍스트)", () => {
    for (const s of ["--panel", "--panel-2", "--panel-3"]) {
      const border = over(t["--input-border"]!, rgb(s));
      expect(contrast(border, rgb(s)), `border/${s}`).toBeGreaterThanOrEqual(3);
      expect(contrast(border, inputBg(s)), `border/input/${s}`).toBeGreaterThanOrEqual(3);
    }
  });
  it("초점 고리(강조색 85%)가 배경에서 3:1 이상", () => {
    expect(contrast(over(`rgba(${rgb("--accent").join(",")},.85)`, rgb("--bg")), rgb("--bg"))).toBeGreaterThanOrEqual(3);
  });
  it("입력 칸이 토큰을 쓰고, 어두운 색 구성표를 알려요", () => {
    expect(css).toMatch(/color-scheme:\s*dark/);
    expect(css).toMatch(/\.input\s*\{[^}]*border:\s*1px solid var\(--input-border\)/);
    expect(css).toMatch(/\.input::placeholder[^{]*\{\s*color:\s*var\(--placeholder\)/);
  });
});
