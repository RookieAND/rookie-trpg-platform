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
import { CHAT_PAGE_MAX, LOG_KINDS, LOG_PAGE_MAX, isLogKind, parseScenarioText, type LogKind, type LogQuery, type Role, type ScenarioDoc } from "@coc-vtt/shared";
import { AuthService } from "../../../identity/application/auth.service";
import { ClientIpResolver } from "../../../identity/application/client-ip";
import { guardJson } from "../../../platform/json-guard";
import { readBody } from "../../../platform/read-body";
import { DiscordNotifier } from "../../application/discord-notifier";
import { RoomLimitError, RoomRegistry, type LoadedRoom } from "../../application/room-registry";
import { MAX_SCENARIO_BODY, ScenarioService } from "../../application/scenario.service";
import { RoomHub } from "../ws/room.hub";
import { isValidWebhookUrl, maskWebhook } from "../../domain/discord";
import { SlidingLimiter } from "../../../platform/sliding-limiter";

const createSchema = z.object({ name: z.string().trim().min(1).max(60) });
const inviteSchema = z
  .object({
    /** pl(기본)은 PL 초대 링크, spectator는 읽기 전용 관전 링크 */
    kind: z.enum(["pl", "spectator"]).default("pl"),
    /** 관전 링크를 없앤다(관전 링크에만 쓴다) */
    revoke: z.boolean().optional(),
    expiresInMinutes: z.number().int().min(1).max(60 * 24 * 30).nullable().optional(),
    maxMembers: z.number().int().min(1).max(30).optional(),
  })
  .refine((d) => d.kind === "spectator" || (d.revoke !== true && (d.maxMembers === undefined || d.maxMembers >= 2)), { message: "invalid" });

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
    @Inject(ClientIpResolver) private readonly ips: ClientIpResolver,
  ) {}

  /** 디스코드 설정·시험 메시지 남용 방지: 룸마다 시험은 1분에 3번, 설정 변경은 1분에 10번 */
  private readonly discordTests = new SlidingLimiter(3, 60_000);
  private readonly discordSets = new SlidingLimiter(10, 60_000);

  private async who(req: IncomingMessage) {
    const id = await this.auth.fromRequest(req);
    if (!id) throw new UnauthorizedException("로그인이 필요해요.");
    return id;
  }

  /** 내 룸 목록(내가 만들었거나 참가한 룸) */
  @Get("rooms")
  async mine(@Req() req: IncomingMessage) {
    const me = await this.who(req);
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
    const me = await this.who(req);
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
    const me = await this.who(req);
    const r = await this.registry.remove(roomId, me.userId);
    if (!r.ok) {
      if (r.reason === "not_found") throw new NotFoundException("룸을 찾을 수 없어요.");
      throw new ForbiddenException("룸을 만든 사람만 지울 수 있어요.");
    }
  }

  /** 초대 링크로 들어온 사람이 룸 이름과 입장 가능 여부를 보는 용도 */
  @Get("rooms/:roomId")
  async room(@Req() req: IncomingMessage, @Param("roomId") roomId: string, @Query("invite") invite?: string) {
    const me = await this.who(req);
    const entry = await this.registry.get(roomId);
    if (!entry) throw new NotFoundException("룸을 찾을 수 없어요.");
    const decision = this.registry.decideJoin(entry, me.userId, "pl", invite ?? null);
    if (!decision.ok) throw new ForbiddenException(decision.reason === "banned" ? "이 룸에서 차단됐어요." : decision.reason);
    return {
      id: entry.meta.id,
      name: entry.meta.name,
      ...this.registry.describe(entry, me.userId),
      // 이 링크로 들어가면 어떤 역할이 되는지(관전 링크면 spectator)
      joinAs: decision.role,
      // 주인에게만 초대 정보를 보여 준다.
      ...(entry.meta.ownerId === me.userId
        ? {
            invite: entry.meta.invite,
            spectatorInvite: entry.meta.spectatorInvite ?? null,
            // 웹훅 주소는 비밀이라 돌려주지 않고, 연결 여부와 알림 종류만 알려 준다.
            discord: {
              connected: Boolean(entry.meta.discord),
              events: entry.meta.discord?.events ?? { session: true, rolls: true },
              // 주소는 돌려주지 않고, 어느 웹훅인지 알아볼 만큼만 가려서 보여 준다.
              ...(entry.meta.discord ? { hint: maskWebhook(entry.meta.discord.webhookUrl) } : {}),
            },
          }
        : {}),
    };
  }

  /** 이 사용자가 이 룸에서 어떤 역할로 기록을 볼 수 있는지. 룸 주인은 GM이고, 참가한 적 없는 사람은 볼 수 없다. */
  private async viewerOf(me: { userId: string }, roomId: string) {
    const entry = await this.registry.get(roomId);
    if (!entry) throw new NotFoundException("룸을 찾을 수 없어요.");
    const role: Role | null = entry.meta.ownerId === me.userId ? "kp" : entry.room.roleOf(me.userId);
    if (!role) throw new ForbiddenException("이 룸의 참가자만 볼 수 있어요.");
    return { entry, viewer: { userId: me.userId, role } };
  }

  private intParam(v: string | undefined, name: string): number | undefined {
    if (v === undefined || v === "") return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) throw new BadRequestException(`${name} 값이 올바르지 않아요.`);
    return n;
  }

  /** 이전 대화 더 보기. before(seq) 앞의 대화를 최근 것부터 limit개 돌려준다. 귓속말은 보낸 사람과 받는 사람에게만 간다. */
  @Get("rooms/:roomId/chat")
  async chatPage(@Req() req: IncomingMessage, @Param("roomId") roomId: string, @Query("before") before?: string, @Query("limit") limit?: string) {
    const me = await this.who(req);
    const { entry, viewer } = await this.viewerOf(me, roomId);
    const b = this.intParam(before, "before") ?? Number.MAX_SAFE_INTEGER;
    const l = Math.min(this.intParam(limit, "limit") ?? 50, CHAT_PAGE_MAX);
    return entry.room.chatPage(viewer, b, l);
  }

  /**
   * 세션 기록. 보는 사람이 볼 수 있는 것만 오고(참가자는 공개된 기록만), 오래된 순으로 최근 limit개다.
   * kinds=roll,chat / since,until=ms / session=번호 / before=기록 번호(이전 쪽). view=public이면 GM도 참가자용으로 걸러서 받는다.
   */
  @Get("rooms/:roomId/log")
  async sessionLog(
    @Req() req: IncomingMessage,
    @Param("roomId") roomId: string,
    @Query("kinds") kinds?: string,
    @Query("since") since?: string,
    @Query("until") until?: string,
    @Query("session") session?: string,
    @Query("before") before?: string,
    @Query("limit") limit?: string,
    @Query("view") view?: string,
  ) {
    const me = await this.who(req);
    const { entry, viewer } = await this.viewerOf(me, roomId);
    const kindList = (kinds ?? "").split(",").map((k) => k.trim()).filter(Boolean);
    if (kindList.some((k) => !isLogKind(k))) throw new BadRequestException(`종류는 ${LOG_KINDS.join(", ")} 중에서 골라 주세요.`);
    const q: LogQuery = { kinds: kindList as LogKind[], limit: Math.min(this.intParam(limit, "limit") ?? 200, LOG_PAGE_MAX) };
    const s = this.intParam(since, "since");
    const u = this.intParam(until, "until");
    const n = this.intParam(session, "session");
    const b = this.intParam(before, "before");
    if (s !== undefined) q.since = s;
    if (u !== undefined) q.until = u;
    if (n !== undefined) q.session = n;
    if (b !== undefined) q.before = b;
    // 참가자용으로 보기: 사용자 없는 PL 시점이라 모두에게 공개된 기록만 온다.
    const asPublic = view === "public" && viewer.role === "kp";
    return { ...entry.room.logFor(asPublic ? { userId: "", role: "pl" } : viewer, q), audience: asPublic || viewer.role !== "kp" ? "public" : "gm" };
  }

  @Post("rooms/:roomId/invite")
  @HttpCode(200)
  async regenerate(@Req() req: IncomingMessage, @Param("roomId") roomId: string, @Body() body: unknown) {
    const me = await this.who(req);
    const parsed = inviteSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException("초대 설정이 올바르지 않아요.");
    const r = await this.registry.regenerateInvite(roomId, me.userId, parsed.data);
    if (!r.ok) {
      if (r.reason === "not_found") throw new NotFoundException("룸을 찾을 수 없어요.");
      throw new ForbiddenException("룸 주인만 초대 링크를 바꿀 수 있어요.");
    }
    return r.invite ?? { revoked: true };
  }

  /** 디스코드 알림 설정(룸 주인만). webhookUrl이 null이면 해제한다. */
  @Put("rooms/:roomId/discord")
  async setDiscord(@Req() req: IncomingMessage, @Param("roomId") roomId: string, @Body() body: unknown) {
    const me = await this.who(req);
    const parsed = discordSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("디스코드 설정이 올바르지 않아요.");
    if (!this.discordSets.take(roomId)) throw new HttpException("디스코드 설정을 너무 자주 바꿨어요. 잠시 뒤에 다시 해 주세요.", 429);
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
    const me = await this.who(req);
    const entry = await this.registry.get(roomId);
    if (!entry) throw new NotFoundException("룸을 찾을 수 없어요.");
    if (entry.meta.ownerId !== me.userId) throw new ForbiddenException("룸 주인만 시험 메시지를 보낼 수 있어요.");
    if (!entry.meta.discord) throw new BadRequestException("먼저 웹훅 주소를 저장해 주세요.");
    if (!this.discordTests.take(roomId)) throw new HttpException("시험 메시지를 너무 자주 보냈어요. 1분 뒤에 다시 해 주세요.", 429);
    try {
      await this.notifier.test(entry.meta.discord.webhookUrl, entry.meta.name);
    } catch {
      throw new BadRequestException("디스코드에 보내지 못했어요. 웹훅 주소가 맞는지, 삭제되지 않았는지 확인해 주세요.");
    }
    return { ok: true };
  }

  /**
   * 룸 주인이 대화(귓속말 포함)와 세션 기록을 비운다("기록 비우기"). 되돌릴 수 없다.
   * scope=chat | log | all(기본). 룸 안의 모든 화면에서 해당 목록이 지워지고, 저장된 데이터에서도 바로 사라진다.
   * 굴림 기록·시트·핸드아웃은 그대로 둔다(룸을 통째로 지우려면 DELETE /rooms/:id).
   */
  @Delete("rooms/:roomId/history")
  @HttpCode(200)
  async purgeHistory(@Req() req: IncomingMessage, @Param("roomId") roomId: string, @Query("scope") scope?: string) {
    const me = await this.who(req);
    const entry = await this.registry.get(roomId);
    if (!entry) throw new NotFoundException("룸을 찾을 수 없어요.");
    if (entry.meta.ownerId !== me.userId) throw new ForbiddenException("룸 주인만 기록을 비울 수 있어요.");
    const s = scope ?? "all";
    if (s !== "chat" && s !== "log" && s !== "all") throw new BadRequestException("범위는 chat, log, all 중에서 골라 주세요.");
    const what = { chat: s !== "log", log: s !== "chat" };
    const outs = entry.room.purgeHistory(what);
    this.hub.publish(entry, outs);
    // 지운 내용이 저장소에 남지 않게 기다렸다 저장한다.
    await this.registry.save(entry);
    return { ok: true, ...what };
  }

  /** 룸 주인이 룸 이름을 바꾼다. */
  @Patch("rooms/:roomId")
  async rename(@Req() req: IncomingMessage, @Param("roomId") roomId: string, @Body() body: unknown) {
    const me = await this.who(req);
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
    if (body === "too_large") throw new HttpException(`파일이 너무 커요. ${MAX_SCENARIO_BODY / 1024 / 1024}MB까지 가져올 수 있어요.`, 413);
    // 파싱 전에 모양만 훑는다: 맨 바깥이 { }가 아니거나, 너무 깊거나 항목이 어마어마한 글은 여기서 돌려보낸다.
    const shape = guardJson(body);
    if (!shape.ok) {
      throw new HttpException(shape.reason === "not_object" ? "시나리오 파일이 아니에요. 맨 바깥이 { } 항목이어야 해요." : "파일 구조가 너무 복잡해서 읽을 수 없어요.", shape.reason === "not_object" ? 422 : 413);
    }
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
    const me = await this.who(req);
    const entry = await this.registry.get(roomId);
    if (!entry) throw new NotFoundException("룸을 찾을 수 없어요.");
    if (entry.meta.ownerId !== me.userId) throw new ForbiddenException("룸 주인(GM)만 시나리오를 가져올 수 있어요.");
    const dry = dryRun === "1" || dryRun === "true";
    // 미리보기도 한 번으로 센다(큰 파일을 반복해서 보내 서버를 붙잡는 것을 막는다).
    if (this.scenarios.tooMany(me.userId)) throw new HttpException("시나리오를 너무 많이 가져왔어요. 잠시 뒤에 다시 해 주세요.", 429);
    const slot = this.slot(me.userId);
    try {
      return await this.importIntoRoom(req, entry, me.userId, dry);
    } finally {
      slot.release();
    }
  }

  /** 가져오기 자리를 잡는다. 한 사람이 동시에 하나만, 서버 전체로도 몇 개까지만. */
  private slot(userId: string) {
    const s = this.scenarios.begin(userId);
    if (!s.ok) throw new HttpException(s.reason === "user" ? "이미 가져오는 중이에요. 끝나면 다시 해 주세요." : "지금 가져오는 사람이 많아요. 잠시 뒤에 다시 해 주세요.", 429);
    return s;
  }

  private async importIntoRoom(req: IncomingMessage, entry: LoadedRoom, userId: string, dry: boolean) {
    const me = { userId };
    const doc = await this.readDoc(req);
    const live = entry.room.listMembers().some((m) => m.userId === me.userId && m.role === "kp");
    if (!live) throw new HttpException("룸 화면에 들어온 뒤에 가져올 수 있어요.", 409);
    const resolved = await this.scenarios.resolve(doc, { roomMedia: this.scenarios.mediaOf(entry), store: !dry, who: { userId: me.userId, ip: this.ips.of(req) } });
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
    const me = await this.who(req);
    if (this.scenarios.tooMany(me.userId)) throw new HttpException("시나리오를 너무 많이 가져왔어요. 잠시 뒤에 다시 해 주세요.", 429);
    const slot = this.slot(me.userId);
    try {
      return await this.importNewRoom(req, me.userId, name);
    } finally {
      slot.release();
    }
  }

  private async importNewRoom(req: IncomingMessage, userId: string, name?: string) {
    const me = { userId };
    const doc = await this.readDoc(req);
    const title = (name ?? "").trim().slice(0, 60) || doc.roomName;
    const entry = await this.registry.create(me.userId, title).catch((e) => {
      if (e instanceof RoomLimitError) {
        if (e.code === "too_many_rooms") throw new HttpException("만들 수 있는 룸 수를 넘었어요. 안 쓰는 룸을 지워 주세요.", 403);
        throw new HttpException("룸을 너무 많이 만들었어요. 잠시 뒤에 다시 해 주세요.", 429);
      }
      throw e;
    });
    const resolved = await this.scenarios.resolve(doc, { roomMedia: new Set(), store: true, who: { userId: me.userId, ip: this.ips.of(req) } });
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
    const me = await this.who(req);
    const entry = await this.registry.get(roomId);
    if (!entry) throw new NotFoundException("룸을 찾을 수 없어요.");
    if (entry.meta.ownerId !== me.userId) throw new ForbiddenException("룸 주인만 룸을 내보낼 수 있어요.");
    const r = await this.scenarios.exportRoom(entry, { format: format === "scenario" ? "scenario" : "backup", sheets: sheets === "1" || sheets === "true" });
    res.setHeader("x-export-notes", encodeURIComponent(r.notes.join("|")));
    return r.doc;
  }
}
