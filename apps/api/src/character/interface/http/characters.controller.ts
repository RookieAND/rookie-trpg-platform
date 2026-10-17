import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { IncomingMessage } from "node:http";
import { characterInputSchema } from "@coc-vtt/shared";
import { AuthService } from "../../../identity/application/auth.service";
import { VaultService } from "../../application/vault.service";

/** 내 캐릭터 보관함 */
@Controller("characters")
export class CharactersController {
  constructor(
    @Inject(VaultService) private readonly vault: VaultService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  private me(req: IncomingMessage) {
    const id = this.auth.fromRequest(req);
    if (!id) throw new UnauthorizedException("로그인이 필요해요.");
    return id.userId;
  }

  private parse(body: unknown) {
    const parsed = characterInputSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new BadRequestException(`캐릭터 정보가 올바르지 않아요${first ? ` (${first.path.join(".") || "형식"})` : ""}.`);
    }
    return parsed.data;
  }

  @Get()
  list(@Req() req: IncomingMessage) {
    return this.vault.list(this.me(req));
  }

  @Post()
  async create(@Req() req: IncomingMessage, @Body() body: unknown) {
    const r = await this.vault.create(this.me(req), this.parse(body));
    if (!r.ok) throw new ConflictException("보관함이 가득 찼어요. 쓰지 않는 캐릭터를 지워 주세요.");
    return r.character;
  }

  @Put(":id")
  async update(@Req() req: IncomingMessage, @Param("id") id: string, @Body() body: unknown) {
    const r = await this.vault.update(this.me(req), id, this.parse(body));
    if (!r.ok) throw new NotFoundException("캐릭터를 찾을 수 없어요.");
    return r.character;
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Req() req: IncomingMessage, @Param("id") id: string) {
    if (!(await this.vault.remove(this.me(req), id))) throw new NotFoundException("캐릭터를 찾을 수 없어요.");
  }
}
