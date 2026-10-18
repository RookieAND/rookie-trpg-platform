import { describe, expect, it } from "vitest";
import { firstImageFile, imageFormatError } from "./images";

const f = (type: string) => ({ type, name: "x", size: 1 }) as unknown as File;

describe("imageFormatError", () => {
  it("PNG·JPG·GIF·WEBP는 통과", () => {
    for (const t of ["image/png", "image/jpeg", "image/gif", "image/webp"]) expect(imageFormatError({ type: t })).toBeNull();
  });
  it("그 밖의 형식은 안내 문구", () => {
    expect(imageFormatError({ type: "image/svg+xml" })).toMatch(/PNG/);
    expect(imageFormatError({ type: "application/pdf" })).not.toBeNull();
    expect(imageFormatError({ type: "" })).not.toBeNull();
  });
});

describe("firstImageFile", () => {
  it("이미지가 아닌 파일은 건너뛰고 첫 이미지를 고른다", () => {
    const a = f("text/plain");
    const b = f("image/png");
    expect(firstImageFile([a, b, f("image/gif")])).toBe(b);
  });
  it("이미지가 없거나 목록이 없으면 null", () => {
    expect(firstImageFile([f("text/plain")])).toBeNull();
    expect(firstImageFile(null)).toBeNull();
    expect(firstImageFile([])).toBeNull();
  });
});
