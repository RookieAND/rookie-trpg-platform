/** 업로드한 이미지 파일을 읽고 쓰는 저장소(포트). 나중에 R2/S3로 바꿀 수 있다. */
export const IMAGE_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type ImageMime = (typeof IMAGE_MIMES)[number];
export const AUDIO_MIMES = ["audio/mpeg", "audio/ogg", "audio/wav", "audio/mp4"] as const;
export type AudioMime = (typeof AUDIO_MIMES)[number];
export type MediaMime = ImageMime | AudioMime;

export interface StoredImage {
  bytes: Buffer;
  mime: MediaMime;
}

export interface ImageStorage {
  put(id: string, image: StoredImage): Promise<void>;
  get(id: string): Promise<StoredImage | null>;
}

export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
export const IMAGE_ID = /^[a-f0-9]{32}$/;

/** 파일 앞부분으로 형식을 알아낸다. 클라이언트가 말한 형식은 믿지 않고, SVG는 받지 않는다. */
export function sniffImage(b: Buffer): ImageMime | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && (b.subarray(0, 6).toString("latin1") === "GIF87a" || b.subarray(0, 6).toString("latin1") === "GIF89a")) return "image/gif";
  if (b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/** 오디오 파일 앞부분으로 형식을 알아낸다. */
export function sniffAudio(b: Buffer): AudioMime | null {
  const head = (from: number, to: number) => b.subarray(from, to).toString("latin1");
  if (b.length >= 3 && head(0, 3) === "ID3") return "audio/mpeg";
  if (b.length >= 2 && b[0] === 0xff && ((b[1] as number) & 0xe0) === 0xe0) return "audio/mpeg";
  if (b.length >= 4 && head(0, 4) === "OggS") return "audio/ogg";
  if (b.length >= 12 && head(0, 4) === "RIFF" && head(8, 12) === "WAVE") return "audio/wav";
  if (b.length >= 12 && head(4, 8) === "ftyp") return "audio/mp4";
  return null;
}

export const isAudioMime = (m: MediaMime): m is AudioMime => (AUDIO_MIMES as readonly string[]).includes(m);
