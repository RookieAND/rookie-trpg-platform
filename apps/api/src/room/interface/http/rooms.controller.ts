import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { parseScenarioText, type ScenarioDoc } from "@coc-vtt/shared";
import { AuthService } from "../../../identity/application/auth.service";
import { readBody } from "../../../platform/read-body";
import { DiscordNotifier } from "../../application/discord-notifier";
import { RoomLimitError, RoomRegistry } from "../../application/room-registry";
import { MAX_SCENARIO_BODY, ScenarioService } from "../../application/scenario.service";
import { RoomHub } from "../ws/room.hub";
import { isValidWebhookUrl } from "../../domain/discord";
import { APP_VERSION } from "../../../version";

const createSchema = z.object({ name: z.string().trim().min(1).max(60) });
const inviteSchema = z.object({
  expiresInMinutes: z.number().int().min(1).max(60 * 24 * 30).nullable().optional(),
  maxMembers: z.number().int().min(2).max(12).optional(),
});

const renameSchema = z.object({ name: z.string().trim().min(1).max(60) });

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
    @Inject(ScenarioService) private readonly scenarios: ScenarioService,
    @Inject(RoomHub) private readonly hub: RoomHub,
  ) {}

  private who(req: IncomingMessage) {
    const id = this.auth.fromRequest(req);
    if (!id) throw new UnauthorizedException("로그인이 필요해요.");
    return id;
  }

  @Get("health")
  health() {
    // 비밀이나 설정은 싣지 않는다. 배포 확인용 최소 정보만.
    return { ok: true, rooms: this.registry.roomCount(), version: APP_VERSION, uptimeSec: Math.floor(process.uptime()) };
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
    const entry = await this.registry.create(me.userId, parsed.data.name).catch((e) => {
      if (e instanceof RoomLimitError) {
        if (e.code === "too_many_rooms") throw new HttpException("만들 수 있는 룸 수를 넘었어요. 안 쓰는 룸을 지워 주세요.", 403);
        throw new HttpException("룸을 너무 많이 만들었어요. 잠시 뒤에 다시 해 주세요.", 429);
      }
      throw e;
    });
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

  /** 룸 주인이 룸 이름을 바꾼다. */
  @Patch("rooms/:roomId")
  async rename(@Req() req: IncomingMessage, @Param("roomId") roomId: string, @Body() body: unknown) {
    const me = this.who(req);
    const parsed = renameSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("룸 이름을 1~60자로 적어 주세요.");
    const r = await this.registry.rename(roomId, me.userId, parsed.data.name);
    if (!r.ok) {
      if (r.reason === "not_found") throw new NotFoundException("룸을 찾을 수 없어요.");
      throw new ForbiddenException("룸 주인만 이름을 바꿀 수 있어요.");
    }
    return { id: roomId, name: r.name };
  }

  /** 본문(JSON 글)을 읽어 시나리오·백업 문서로 검사한다. 오류는 위치와 이유 목록으로 돌려준다(422). */
  private async readDoc(req: IncomingMessage): Promise<ScenarioDoc> {
    const body = await readBody(req, MAX_SCENARIO_BODY);
    if (body === "too_large") throw new HttpException("파일이 너무 커요. 64MB까지 가져올 수 있어요.", 413);
    const parsed = parseScenarioText(body.toString("utf8"));
    if (!parsed.ok) {
      const errors = parsed.errors.map((e) => `${e.where}: ${e.message}`);
      throw new HttpException({ message: `파일에 문제가 ${errors.length}곳 있어요. ${errors[0]}`, errors }, 422);
    }
    return parsed.doc;
  }

  /**
   * 시나리오·백업을 이 룸에 더한다(룸 주인만). 본문은 파일 글 그대로(text/plain).
   * dryRun=1이면 검사만 하고 만들어질 개수와 경고를 알려 준다. 가져오면 importId를 돌려주고,
   * 웹소켓 명령 scenario.revert로 방금 가져온 것을 지울 수 있다.
   */
  @Post("rooms/:roomId/scenario")
  @HttpCode(200)
  async importInto(@Req() req: IncomingMessage, @Param("roomId") roomId: string, @Query("dryRun") dryRun?: string) {
    const me = this.who(req);
    const entry = await this.registry.get(roomId);
    if (!entry) throw new NotFoundException("룸을 찾을 수 없어요.");
    if (entry.meta.ownerId !== me.userId) throw new ForbiddenException("룸 주인(GM)만 시나리오를 가져올 수 있어요.");
    const dry = dryRun === "1" || dryRun === "true";
    if (!dry && this.scenarios.tooMany(me.userId)) throw new HttpException("시나리오를 너무 많이 가져왔어요. 잠시 뒤에 다시 해 주세요.", 429);
    const doc = await this.readDoc(req);
    const live = entry.room.snapshot({ userId: "", role: "spectator" }).members.some((m) => m.userId === me.userId && m.role === "kp");
    if (!live) throw new HttpException("룸 화면에 들어온 뒤에 가져올 수 있어요.", 409);
    const resolved = await this.scenarios.resolve(doc, { roomMedia: this.scenarios.mediaOf(entry), store: !dry });
    const r = entry.room.importScenario(me.userId, resolved.doc, { dryRun: dry });
    if (!r.ok) {
      await this.scenarios.discard(resolved.created);
      throw new HttpException({ message: r.message, errors: r.errors }, r.code === "forbidden" ? 403 : 422);
    }
    if (!dry) this.hub.publish(entry, r.out);
    return { dryRun: dry, importId: r.report.importId, counts: r.report.counts, warnings: [...resolved.warnings, ...r.report.warnings], reusedScene: r.report.reusedScene, roomName: doc.roomName };
  }

  /** 시나리오·백업 파일로 새 룸을 만든다. 만든 사람이 GM이 된다. name을 주면 파일의 roomName 대신 쓴다. */
  @Post("rooms/import")
  @HttpCode(201)
  async importNew(@Req() req: IncomingMessage, @Query("name") name?: string) {
    const me = this.who(req);
    if (this.scenarios.tooMany(me.userId)) throw new HttpException("시나리오를 너무 많이 가져왔어요. 잠시 뒤에 다시 해 주세요.", 429);
    const doc = await this.readDoc(req);
    const title = (name ?? "").trim().slice(0, 60) || doc.roomName;
    const entry = await this.registry.create(me.userId, title).catch((e) => {
      if (e instanceof RoomLimitError) {
        if (e.code === "too_many_rooms") throw new HttpException("만들 수 있는 룸 수를 넘었어요. 안 쓰는 룸을 지워 주세요.", 403);
        throw new HttpException("룸을 너무 많이 만들었어요. 잠시 뒤에 다시 해 주세요.", 429);
      }
      throw e;
    });
    const resolved = await this.scenarios.resolve(doc, { roomMedia: new Set(), store: true });
    const r = entry.room.importScenario(null, resolved.doc, { newRoom: true, ownerId: me.userId });
    if (!r.ok) {
      await this.registry.remove(entry.meta.id, me.userId);
      await this.scenarios.discard(resolved.created);
      throw new HttpException({ message: r.message, errors: r.errors }, 422);
    }
    await this.registry.save(entry);
    return { id: entry.meta.id, name: entry.meta.name, invite: entry.meta.invite, counts: r.report.counts, warnings: [...resolved.warnings, ...r.report.warnings] };
  }

  /**
   * 룸을 파일로 내보낸다(룸 주인만). format=backup(설정 포함) 또는 scenario, sheets=1이면 시트도 담는다.
   * 웹훅 주소·초대·접속한 사람의 정보는 담지 않는다. 못 담은 것은 x-export-notes 머리글(퍼센트 인코딩, | 로 구분)로 알린다.
   */
  @Get("rooms/:roomId/export")
  async exportRoom(
    @Req() req: IncomingMessage,
    @Param("roomId") roomId: string,
    @Query("format") format: string | undefined,
    @Query("sheets") sheets: string | undefined,
    @Res({ passthrough: true }) res: ServerResponse,
  ) {
    const me = this.who(req);
    const entry = await this.registry.get(roomId);
    if (!entry) throw new NotFoundException("룸을 찾을 수 없어요.");
    if (entry.meta.ownerId !== me.userId) throw new ForbiddenException("룸 주인만 룸을 내보낼 수 있어요.");
    const r = await this.scenarios.exportRoom(entry, { format: format === "scenario" ? "scenario" : "backup", sheets: sheets === "1" || sheets === "true" });
    res.setHeader("x-export-notes", encodeURIComponent(r.notes.join("|")));
    return r.doc;
  }
}
