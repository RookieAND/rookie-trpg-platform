import { Controller, Get, HttpException, Inject, NotFoundException, Param, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import { AuthService } from "../../../identity/application/auth.service";
import { ImageService } from "../../application/image.service";
import { IMAGE_ID, MAX_AUDIO_BYTES, MAX_IMAGE_BYTES } from "../../domain/image-storage";

const MESSAGE = {
  too_large: "파일이 너무 커요. 이미지는 3MB, 오디오는 10MB까지 올릴 수 있어요.",
  bad_type: "지원하지 않는 파일이에요. 이미지는 PNG, JPG, GIF, WEBP, 오디오는 MP3, OGG, WAV, M4A만 올릴 수 있어요.",
  rate_limited: "이미지를 너무 많이 올렸어요. 잠시 뒤에 다시 해 주세요.",
  empty: "빈 파일이에요.",
} as const;

async function readBody(req: IncomingMessage, max: number): Promise<Buffer | "too_large"> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > max) return "too_large";
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const b = chunk as Buffer;
    size += b.length;
    if (size > max) return "too_large";
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

/** 이미지 올리기와 보기. 올리기는 로그인이 필요하고, 보기는 추측할 수 없는 id가 곧 열쇠다(<img>는 헤더를 못 싣는다). */
@Controller("images")
export class ImagesController {
  constructor(
    @Inject(ImageService) private readonly images: ImageService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Post()
  async upload(@Req() req: IncomingMessage) {
    const me = this.auth.fromRequest(req);
    if (!me) throw new UnauthorizedException("로그인이 필요해요.");
    const body = await readBody(req, MAX_IMAGE_BYTES);
    const r = body === "too_large" ? ({ ok: false, code: "too_large" } as const) : await this.images.upload(me.userId, body);
    if (!r.ok) throw new HttpException(MESSAGE[r.code], r.code === "too_large" ? 413 : r.code === "rate_limited" ? 429 : 400);
    return { id: r.id };
  }

  @Get(":id")
  async view(@Param("id") id: string, @Res() res: ServerResponse) {
    await serve(this.images, id, "image", res);
  }
}

async function serve(images: ImageService, id: string, kind: "image" | "audio", res: ServerResponse) {
  const file = IMAGE_ID.test(id) ? await images.get(id, kind) : null;
  if (!file) throw new NotFoundException(kind === "audio" ? "오디오를 찾을 수 없어요." : "이미지를 찾을 수 없어요.");
  res.statusCode = 200;
  res.setHeader("content-type", file.mime);
  res.setHeader("content-length", file.bytes.length);
  res.setHeader("cache-control", "public, max-age=31536000, immutable");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("cross-origin-resource-policy", "cross-origin");
  res.setHeader("content-security-policy", "default-src 'none'; sandbox");
  res.end(file.bytes);
}

/** 배경음·효과음 파일 올리기와 받기. 규칙은 이미지와 같고 크기만 10MB까지다. */
@Controller("audio")
export class AudioController {
  constructor(
    @Inject(ImageService) private readonly images: ImageService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  @Post()
  async upload(@Req() req: IncomingMessage) {
    const me = this.auth.fromRequest(req);
    if (!me) throw new UnauthorizedException("로그인이 필요해요.");
    const body = await readBody(req, MAX_AUDIO_BYTES);
    const r = body === "too_large" ? ({ ok: false, code: "too_large" } as const) : await this.images.uploadAudio(me.userId, body);
    if (!r.ok) throw new HttpException(MESSAGE[r.code], r.code === "too_large" ? 413 : r.code === "rate_limited" ? 429 : 400);
    return { id: r.id };
  }

  @Get(":id")
  async view(@Param("id") id: string, @Res() res: ServerResponse) {
    await serve(this.images, id, "audio", res);
  }
}
