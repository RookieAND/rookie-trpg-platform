/** 시험용 이미지 파일 머리 만들기. 그림 데이터는 비어 있어도 되고, 머리의 가로·세로만 읽는 검사에 쓴다. */
const u16be = (n: number) => Buffer.from([(n >> 8) & 0xff, n & 0xff]);
const u32be = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};

/** 진짜 1×1 PNG */
export const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

export const pngOf = (width: number, height: number): Buffer =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), u32be(13), Buffer.from("IHDR"), u32be(width), u32be(height), Buffer.from([8, 2, 0, 0, 0]), u32be(0), Buffer.alloc(16, 1)]);

export const gifOf = (width: number, height: number): Buffer => {
  const b = Buffer.alloc(32);
  b.write("GIF89a", 0, "latin1");
  b.writeUInt16LE(width, 6);
  b.writeUInt16LE(height, 8);
  return b;
};

/** SOI + APP0(JFIF) + SOF0 */
export const jpegOf = (width: number, height: number): Buffer =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe0]),
    u16be(16),
    Buffer.from("JFIF\0", "latin1"),
    Buffer.alloc(9, 0),
    Buffer.from([0xff, 0xc0]),
    u16be(17),
    Buffer.from([8]),
    u16be(height),
    u16be(width),
    Buffer.from([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    Buffer.alloc(8, 0),
  ]);

const riff = (chunk: Buffer) => {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(chunk.length + 4);
  return Buffer.concat([Buffer.from("RIFF"), size, Buffer.from("WEBP"), chunk]);
};
const chunkOf = (kind: string, body: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from(kind), len, body]);
};

export const webpLossyOf = (width: number, height: number): Buffer => {
  const body = Buffer.alloc(20);
  body.set([0x9d, 0x01, 0x2a], 3);
  body.writeUInt16LE(width, 6);
  body.writeUInt16LE(height, 8);
  return riff(chunkOf("VP8 ", body));
};

export const webpLosslessOf = (width: number, height: number): Buffer => {
  const body = Buffer.alloc(16);
  body[0] = 0x2f;
  body.writeUInt32LE(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14), 1);
  return riff(chunkOf("VP8L", body));
};

export const webpExtendedOf = (width: number, height: number): Buffer => {
  const body = Buffer.alloc(10);
  body.writeUIntLE(width - 1, 4, 3);
  body.writeUIntLE(height - 1, 7, 3);
  return riff(chunkOf("VP8X", body));
};
