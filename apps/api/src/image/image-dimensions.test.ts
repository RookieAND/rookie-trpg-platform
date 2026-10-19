import { describe, expect, it } from "vitest";
import { checkDimensions, imageDimensions, MAX_IMAGE_PIXELS, MAX_IMAGE_SIDE } from "./domain/image-dimensions";
import { sniffImage } from "./domain/image-storage";
import { ImageService } from "./application/image.service";
import { MemoryImageStorage } from "./infrastructure/memory-image.storage";
import { PNG_1x1, gifOf, jpegOf, pngOf, webpExtendedOf, webpLosslessOf, webpLossyOf } from "./test-images";

/** S-06: 파일 머리만 읽어 픽셀 폭탄을 거절한다. */
describe("이미지 머리에서 가로·세로 읽기", () => {
  it("진짜 PNG(1×1)", () => expect(imageDimensions(PNG_1x1, "image/png")).toEqual({ width: 1, height: 1 }));
  it("PNG", () => expect(imageDimensions(pngOf(640, 480), "image/png")).toEqual({ width: 640, height: 480 }));
  it("GIF", () => expect(imageDimensions(gifOf(300, 200), "image/gif")).toEqual({ width: 300, height: 200 }));
  it("JPEG(APP0 뒤의 SOF0)", () => expect(imageDimensions(jpegOf(1024, 768), "image/jpeg")).toEqual({ width: 1024, height: 768 }));
  it("WEBP 세 가지(VP8, VP8L, VP8X)", () => {
    expect(imageDimensions(webpLossyOf(400, 300), "image/webp")).toEqual({ width: 400, height: 300 });
    expect(imageDimensions(webpLosslessOf(512, 256), "image/webp")).toEqual({ width: 512, height: 256 });
    expect(imageDimensions(webpExtendedOf(2000, 1500), "image/webp")).toEqual({ width: 2000, height: 1500 });
  });
  it("깨진 머리는 null", () => {
    expect(imageDimensions(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]), "image/png")).toBeNull();
    expect(imageDimensions(Buffer.from("RIFF....WEBP"), "image/webp")).toBeNull();
    expect(imageDimensions(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00]), "image/jpeg")).toBeNull();
    expect(imageDimensions(Buffer.from("GIF89a"), "image/gif")).toBeNull();
  });
});

describe("한도", () => {
  it("한 변 8000px, 4천만 화소까지", () => {
    expect(checkDimensions(pngOf(MAX_IMAGE_SIDE, 5000), "image/png")).toBe("ok"); // 40MP 딱 맞음
    expect(checkDimensions(pngOf(MAX_IMAGE_SIDE, 5001), "image/png")).toBe("too_big");
    expect(checkDimensions(pngOf(MAX_IMAGE_SIDE + 1, 10), "image/png")).toBe("too_big");
    expect(MAX_IMAGE_PIXELS).toBe(40_000_000);
    expect(checkDimensions(pngOf(0, 10), "image/png")).toBe("unreadable");
  });
});

describe("ImageService가 픽셀 폭탄을 거절한다", () => {
  const svc = () => new ImageService(new MemoryImageStorage());
  const flood: Array<[string, Buffer]> = [
    ["PNG 30000×30000", pngOf(30000, 30000)],
    ["PNG 4294967295×1", pngOf(0xffffffff, 1)],
    ["GIF 65535×65535", gifOf(65535, 65535)],
    ["JPEG 65500×65500", jpegOf(65500, 65500)],
    ["WEBP(VP8X) 16000×16000", webpExtendedOf(16000, 16000)],
    ["WEBP(VP8L) 16384×16384", webpLosslessOf(16384, 16384)],
  ];
  for (const [label, bytes] of flood) {
    it(`${label}는 용량이 작아도 거절 (bad_size)`, async () => {
      expect(bytes.length).toBeLessThan(200);
      expect(sniffImage(bytes)).not.toBeNull(); // 매직 바이트만 보던 예전 검사는 통과시켰다
      const r = await svc().upload("u", bytes);
      expect(r).toEqual({ ok: false, code: "bad_size" });
    });
  }
  it("머리가 가짜인 파일(RIFF....WEBP 12바이트, JPEG 표식 뒤 글자)은 거절 (bad_type)", async () => {
    expect(await svc().upload("u", Buffer.from("RIFF\0\0\0\0WEBP"))).toEqual({ ok: false, code: "bad_type" });
    expect(await svc().upload("u", Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("<script>alert(1)</script>")]))).toEqual({ ok: false, code: "bad_type" });
  });
  it("정상 크기는 받는다", async () => {
    const s = svc();
    for (const b of [PNG_1x1, pngOf(4000, 4000), gifOf(100, 100), jpegOf(3000, 2000), webpLossyOf(800, 600)]) expect((await s.upload("u", b)).ok).toBe(true);
  });
  it("저장하는 길(가져오기)도 같은 검사를 쓴다", async () => {
    const r = await svc().storeChecked(pngOf(30000, 30000), "image");
    expect(r).toEqual({ ok: false, code: "bad_size" });
  });
});
