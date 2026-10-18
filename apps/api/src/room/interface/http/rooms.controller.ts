import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { IncomingMessage } from "node:http";
import { z } from "zod";
import { AuthService } from "../../../identity/application/auth.service";
import { DiscordNotifier } from "../../application/discord-notifier";
import { RoomRegistry } from "../../application/room-registry";
import { isValidWebhookUrl } from "../../domain/discord";

const createSchema = z.object({ name: z.string().trim().min(1).max(60) });
const inviteSchema = z.object({
  expiresInMinutes: z.number().int().min(1).max(60 * 24 * 30).nullable().optional(),
  maxMembers: z.number().int().min(2).max(12).optional(),
});

const discordSchema = z.object({
  /** null이면 알림을 끄고, 생략하면 저장된 주소를 그대로 두고 알림 종류만 바꾼다. */
  webhookUrl: z.string().trim().max(300).nullable().optional(),
  events: z.object({ session: z.boolean(), rolls: z.boolean() }).default({ session: true, rolls: true }),
});

@Controller()
export class RoomsController {
  constructor(
    @Inject(RoomRegistry) private readonly registry: RoomRegistry,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(DiscordNotifier) private readonly notifier: DiscordNotifier,
  ) {}

  private who(req: IncomingMessage) {
    const id = this.auth.fromRequest(req);
    if (!id) throw new UnauthorizedException("로그인이 필요해요.");
    return id;
  }

  @Get("health")
  health() {
    return { ok: true, rooms: this.registry.roomCount() };
  }

  /** 내 룸 목록(내가 만들었거나 참가한 룸) */
  @Get("rooms")
  async mine(@Req() req: IncomingMessage) {
    const me = this.who(req);
    const rooms = await this.registry.listFor(me.userId);
    return rooms.map((r) => ({
      id: r.meta.id,
      name: r.meta.name,
      role: r.role,
      sessionStatus: r.status,
      sessionNumber: r.sessionNumber,
      online: r.online,
    }));
  }

  @Post("rooms")
  async create(@Req() req: IncomingMessage, @Body() body: unknown) {
    const me = this.who(req);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("룸 이름을 입력해 주세요.");
    const entry = await this.registry.create(me.userId, parsed.data.name);
    // 만든 사람은 이름도 함께 기억해 목록에 보이게 한다(접속 때 멤버로 등록된다).
    return { id: entry.meta.id, name: entry.meta.name, invite: entry.meta.invite };
  }

  /** 룸 주인이 룸을 지운다. 되돌릴 수 없다. */
  @Delete("rooms/:roomId")
  @HttpCode(204)
  async remove(@Req() req: IncomingMessage, @Param("roomId") roomId: string) {
    const me = this.who(req);
    const r = await this.registry.remove(roomId, me.userId);
    if (!r.ok) {
      if (r.reason === "not_found") throw new NotFoundException("룸을 찾을 수 없어요.");
      throw new ForbiddenException("룸을 만든 사람만 지울 수 있어요.");
    }
  }

  /** 초대 링크로 들어온 사람이 룸 이름과 입장 가능 여부를 보는 용도 */
  @Get("rooms/:roomId")
  async room(@Req() req: IncomingMessage, @Param("roomId") roomId: string, @Query("invite") invite?: string) {
    const me = this.who(req);
    const entry = await this.registry.get(roomId);
    if (!entry) throw new NotFoundException("룸을 찾을 수 없어요.");
    const decision = this.registry.decideJoin(entry, me.userId, "pl", invite ?? null);
    if (!decision.ok) throw new ForbiddenException(decision.reason);
    return {
      id: entry.meta.id,
      name: entry.meta.name,
      ...this.registry.describe(entry, me.userId),
      // 주인에게만 초대 정보를 보여 준다.
      ...(entry.meta.ownerId === me.userId
        ? {
            invite: entry.meta.invite,
            // 웹훅 주소는 비밀이라 돌려주지 않고, 연결 여부와 알림 종류만 알려 준다.
            discord: { connected: Boolean(entry.meta.discord), events: entry.meta.discord?.events ?? { session: true, rolls: true } },
          }
        : {}),
    };
  }

  @Post("rooms/:roomId/invite")
  @HttpCode(200)
  async regenerate(@Req() req: IncomingMessage, @Param("roomId") roomId: string, @Body() body: unknown) {
    const me = this.who(req);
    const parsed = inviteSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException("초대 설정이 올바르지 않아요.");
    const r = await this.registry.regenerateInvite(roomId, me.userId, parsed.data);
    if (!r.ok) {
      if (r.reason === "not_found") throw new NotFoundException("룸을 찾을 수 없어요.");
      throw new ForbiddenException("룸 주인만 초대 링크를 바꿀 수 있어요.");
    }
    return r.invite;
  }

  /** 디스코드 알림 설정(룸 주인만). webhookUrl이 null이면 해제한다. */
  @Put("rooms/:roomId/discord")
  async setDiscord(@Req() req: IncomingMessage, @Param("roomId") roomId: string, @Body() body: unknown) {
    const me = this.who(req);
    const parsed = discordSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("디스코드 설정이 올바르지 않아요.");
    const { webhookUrl, events } = parsed.data;
    if (typeof webhookUrl === "string" && !isValidWebhookUrl(webhookUrl)) {
      throw new BadRequestException("디스코드 웹훅 주소 형식이 아니에요. 채널 설정의 연동에서 웹훅 URL을 복사해 주세요.");
    }
    const r = await this.registry.setDiscord(roomId, me.userId, { webhookUrl, events });
    if (!r.ok) {
      if (r.reason === "not_found") throw new NotFoundException("룸을 찾을 수 없어요.");
      if (r.reason === "no_webhook") throw new BadRequestException("먼저 웹훅 주소를 저장해 주세요.");
      throw new ForbiddenException("룸 주인만 디스코드 알림을 설정할 수 있어요.");
    }
    return { connected: r.connected, events };
  }

  /** 저장된 웹훅으로 시험 메시지를 보낸다. */
  @Post("rooms/:roomId/discord/test")
  @HttpCode(200)
  async testDiscord(@Req() req: IncomingMessage, @Param("roomId") roomId: string) {
    const me = this.who(req);
    const entry = await this.registry.get(roomId);
    if (!entry) throw new NotFoundException("룸을 찾을 수 없어요.");
    if (entry.meta.ownerId !== me.userId) throw new ForbiddenException("룸 주인만 시험 메시지를 보낼 수 있어요.");
    if (!entry.meta.discord) throw new BadRequestException("먼저 웹훅 주소를 저장해 주세요.");
    try {
      await this.notifier.test(entry.meta.discord.webhookUrl, entry.meta.name);
    } catch {
      throw new BadRequestException("디스코드에 보내지 못했어요. 웹훅 주소가 맞는지, 삭제되지 않았는지 확인해 주세요.");
    }
    return { ok: true };
  }
}
