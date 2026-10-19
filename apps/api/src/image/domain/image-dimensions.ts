import type { ImageMime } from "./image-storage";

/**
 * 이미지 파일 머리(헤더)만 읽어 가로·세로 픽셀 수를 알아낸다. 그림 자체를 풀지 않는다.
 * 용량은 작은데 픽셀이 어마어마한(예: 3만×3만 PNG) 파일은 보는 사람의 브라우저가 메모리를 다 써서 죽으니,
 * 저장하기 전에 걸러내는 용도다. 머리가 깨졌거나 읽을 수 없으면 null.
 */
export interface Dimensions {
  width: number;
  height: number;
}

/** 한 변 최대 픽셀 */
export const MAX_IMAGE_SIDE = 8000;
/** 전체 픽셀(가로×세로) 최대: 40 메가픽셀 */
export const MAX_IMAGE_PIXELS = 40_000_000;

const be32 = (b: Buffer, o: number) => b.readUInt32BE(o);

function png(b: Buffer): Dimensions | null {
  // 서명 8바이트 다음이 IHDR 조각(길이 13)이어야 한다.
  if (b.length < 24 || be32(b, 8) !== 13 || b.toString("latin1", 12, 16) !== "IHDR") return null;
  return { width: be32(b, 16), height: be32(b, 20) };
}

function gif(b: Buffer): Dimensions | null {
  if (b.length < 10) return null;
  return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
}

function jpeg(b: Buffer): Dimensions | null {
  let i = 2;
  const limit = Math.min(b.length, 1 << 20); // 머리 구간만 훑는다
  while (i + 4 <= limit) {
    if (b[i] !== 0xff) return null;
    let marker = b[i + 1]!;
    // 채움 바이트(FF FF ...)는 건너뛴다.
    while (marker === 0xff && i + 2 < limit) {
      i++;
      marker = b[i + 1]!;
    }
    i += 2;
    // 길이가 없는 표식
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda) return null; // 그림 크기 전에 끝났다
    if (i + 2 > limit) return null;
    const len = b.readUInt16BE(i);
    if (len < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (i + 7 > b.length) return null;
      return { height: b.readUInt16BE(i + 3), width: b.readUInt16BE(i + 5) };
    }
    i += len;
  }
  return null;
}

function webp(b: Buffer): Dimensions | null {
  if (b.length < 30) return null;
  const kind = b.toString("latin1", 12, 16);
  if (kind === "VP8X") {
    return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
  }
  if (kind === "VP8 ") {
    // 프레임 머리: 3바이트 태그 다음 시작 코드 9d 01 2a, 그 뒤 14비트 가로·세로
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
  }
  if (kind === "VP8L") {
    if (b[20] !== 0x2f) return null;
    const bits = b.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return null;
}

export function imageDimensions(bytes: Buffer, mime: ImageMime): Dimensions | null {
  try {
    switch (mime) {
      case "image/png":
        return png(bytes);
      case "image/gif":
        return gif(bytes);
      case "image/jpeg":
        return jpeg(bytes);
      case "image/webp":
        return webp(bytes);
    }
  } catch {
    return null;
  }
}

export type DimensionVerdict = "ok" | "unreadable" | "too_big";

/** 크기가 우리 한도 안인지. 0이거나 읽을 수 없으면 unreadable. */
export function checkDimensions(bytes: Buffer, mime: ImageMime, limits: { side?: number; pixels?: number } = {}): DimensionVerdict {
  const d = imageDimensions(bytes, mime);
  if (!d || d.width < 1 || d.height < 1) return "unreadable";
  if (d.width > (limits.side ?? MAX_IMAGE_SIDE) || d.height > (limits.side ?? MAX_IMAGE_SIDE) || d.width * d.height > (limits.pixels ?? MAX_IMAGE_PIXELS)) return "too_big";
  return "ok";
}
