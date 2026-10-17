import { BadRequestException, Body, ConflictException, Controller, Get, Inject, Put, Req, UnauthorizedException } from "@nestjs/common";
import type { IncomingMessage } from "node:http";
import { AuthService } from "../../../identity/application/auth.service";
import { LibraryService } from "../../application/library.service";

/** 내 서재: 굴림 매크로와 직업 정의 */
@Controller("library")
export class LibraryController {
  constructor(
    @Inject(LibraryService) private readonly library: LibraryService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  private me(req: IncomingMessage) {
    const id = this.auth.fromRequest(req);
    if (!id) throw new UnauthorizedException("로그인이 필요해요.");
    return id.userId;
  }

  @Get()
  get(@Req() req: IncomingMessage) {
    return this.library.get(this.me(req));
  }

  @Put()
  async put(@Req() req: IncomingMessage, @Body() body: unknown) {
    const r = await this.library.replace(this.me(req), body);
    if (!r.ok) {
      if (r.reason === "conflict") throw new ConflictException({ message: "다른 기기에서 서재가 먼저 바뀌었어요.", library: r.library });
      throw new BadRequestException(r.message);
    }
    return r.library;
  }
}
