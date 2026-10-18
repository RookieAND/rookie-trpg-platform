import { PINGS_PER_SECOND, pingRecipients } from "./ping";
import {
  BGM_STOP,
  MAX_SKILLS,
  SAN_CAP,
  SKILL_CAP,
  defaultRng,
  deriveCharacter,
  meetsDifficulty,
  resolveSanCheck,
  rollDie,
  rollExpression,
  rollSumExpression,
  parseSumExpression,
  targetValue,
  type Character,
  type SheetOp,
  type ClientCommand,
  type ErrorCode,
  DEFAULT_EFFECTS,
  DEFAULT_SCENE_ID,
  MAX_AUDIO_TRACKS,
  MAX_FOG_ZONES,
  type FogArea,
  MAX_FOG_EXPLORED,
  MAX_BEATS,
  MAX_BRANCHES,
  MAX_INITIATIVE_ENTRIES,
  MAX_MADNESS_ENTRIES,
  applyLuck,
  josa,
  luckNeeded,
  luckBlockReason,
  pushBlockReason,
  type RollRuleInput,
  type EffectSettings,
  type EndSummary,
  type GameObject,
  type Scene,
  type Transition,
  type AudioTrack,
  type Beat,
  type BgmState,
  type Branch,
  type Flow,
  type Handout,
  type Initiative,
  type InitiativeEntry,
  type Member,
  type Rng,
  type Role,
  type RollLogEntry,
  type ServerEvent,
  type SessionStatus,
  type PauseReason,
  type Snapshot,
  type Visibility,
} from "@coc-vtt/shared";
import { UndoLog } from "./undo";

/**
 * 룸 엔진. 네트워크를 모르는 순수 로직이다.
 * 같은 코드를 로컬 ws 서버와 (나중에) Cloudflare Durable Object가 함께 쓴다.
 *
 * seq는 룸 전체에서 1씩 오르지만, 이벤트마다 받는 사람이 달라서
 * 한 사용자 입장에서는 번호가 건너뛸 수 있다. 건너뛰어도 유실이 아니다.
 */

export interface Actor {
  userId: string;
  name: string;
  role: Role;
}

export interface Audience {
  roles?: Role[];
  users?: string[];
}

export interface Out {
  seq: number;
  event: Exclude<ServerEvent, { type: "snapshot" }>;
  audience: Audience;
}

export type Result = { ok: true; out: Out[] } | { ok: false; code: ErrorCode; message: string; out?: Out[] };

export interface RoomOptions {
  rng?: Rng;
  now?: () => number;
  newId?: () => string;
  /** 다시 접속한 사용자에게 보낼 수 있는 이벤트 수 */
  bufferSize?: number;
  rollsPerSecond?: number;
}

const ALL_ROLES: Role[] = ["kp", "pl", "spectator"];
const MAX_ROLL_LOG = 200;
const MAX_OBJECTS = 500;
const MAX_CHARACTERS = 30;
const MAX_HANDOUTS = 100;
const MAX_SCENES = 30;
const SHEET_PATCHES_PER_SECOND = 10;

export function canSeeHandout(h: Pick<Handout, "visibleTo" | "kpOnly">, viewer: Pick<Member, "userId" | "role">): boolean {
  if (viewer.role === "kp") return true;
  if (h.kpOnly) return false;
  const v = h.visibleTo;
  if (v === "all") return true;
  if (v === "gm") return false;
  return v.includes(viewer.userId);
}

/** 시트는 주인과 GM만 본다. */
export function canSeeCharacter(c: Pick<Character, "ownerId">, viewer: Pick<Member, "userId" | "role">): boolean {
  return viewer.role === "kp" || c.ownerId === viewer.userId;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** activeSceneId를 주면 GM이 아닌 사람은 그 장면의 오브젝트만 본다. */
export function canSee(obj: GameObject, member: Pick<Member, "userId" | "role">, activeSceneId?: string): boolean {
  if (member.role === "kp") return true;
  if (activeSceneId !== undefined && obj.sceneId !== activeSceneId) return false;
  if (obj.layer === "gm") return false;
  const v: Visibility = obj.visibleTo;
  if (v === "all") return true;
  if (v === "gm") return false;
  return v.includes(member.userId);
}

export function inAudience(a: Audience, viewer: Pick<Member, "userId" | "role">): boolean {
  return Boolean(a.roles?.includes(viewer.role) || a.users?.includes(viewer.userId));
}

/** 저장용 룸 상태. 이벤트 버퍼는 저장하지 않는다(복원 뒤 접속자는 snapshot으로 맞춘다). */
export interface RoomData {
  roomId: string;
  seq: number;
  status: SessionStatus;
  /** 일시정지 사유. 이전 버전에서 저장한 데이터에는 없을 수 있다(없으면 GM이 직접 누른 정지로 본다). */
  pauseReason?: PauseReason;
  sessionNumber: number;
  objects: GameObject[];
  /** 이전 버전에서 저장한 데이터에는 없을 수 있다. */
  scenes?: Scene[];
  activeSceneId?: string;
  effects?: EffectSettings;
  madnessTable?: string[];
  initiative?: Initiative | null;
  flow?: Flow;
  audio?: AudioTrack[];
  bgm?: BgmState | null;
  members: Member[];
  rolls: RollLogEntry[];
  /** 이전 버전에서 저장한 데이터에는 없을 수 있다. */
  characters?: Character[];
  handouts?: Handout[];
}

/**
 * 일시정지 중에 GM에게도 막는 명령. 판정(굴림·밀어붙이기·행운·SAN·광기·피해)과 전투 진행,
 * PL에게 바로 드러나는 진행(장면 전환·핸드아웃 펼치기·비트 이동)이다.
 * 그 밖의 장면·시트·핸드아웃·흐름·안개·음향·토큰 편집은 GM이 준비할 수 있다.
 */
export const KP_BLOCKED_WHILE_PAUSED: ReadonlySet<ClientCommand["type"]> = new Set<ClientCommand["type"]>([
  "roll.request",
  "roll.ask",
  "roll.push",
  "luck.spend",
  "san.check",
  "madness.roll",
  "damage.roll",
  "initiative.start",
  "initiative.add",
  "initiative.remove",
  "initiative.dex",
  "initiative.next",
  "initiative.end",
  "scene.activate",
  "handout.show",
  "flow.goto",
  "flow.ending.choose",
]);

export class Room {
  readonly roomId: string;
  private seq = 0;
  private status: SessionStatus = "IDLE";
  /** PAUSED일 때만 의미가 있다. kp_disconnected면 GM이 돌아올 때 자동 재개한다. */
  private pauseReason: PauseReason | null = null;
  /** GM 연결이 끊겨 유예 중이면 끊긴 시각. 유예 시간은 모르며, 시간이 다 되면 호출자가 expireKpAway()를 부른다. */
  private kpAwaySince: number | null = null;
  private sessionNumber: number;
  private objects = new Map<string, GameObject>();
  private scenes = new Map<string, Scene>([[DEFAULT_SCENE_ID, { id: DEFAULT_SCENE_ID, name: "장면 1" }]]);
  private activeSceneId = DEFAULT_SCENE_ID;
  private effects: EffectSettings = cloneEffects(DEFAULT_EFFECTS);
  private madnessTable: string[] = [];
  private initiative: Initiative | null = null;
  private audio: AudioTrack[] = [];
  private bgm: BgmState | null = null;
  private flow: Flow = { beats: [], branches: [], current: null, suggestions: [] };
  /** 이 비트에서 GM이 넘긴 제안. 같은 비트에 머무는 동안 다시 제안하지 않는다. */
  private dismissed = new Set<string>();
  private members = new Map<string, Member>();
  private rolls: RollLogEntry[] = [];
  private characters = new Map<string, Character>();
  private handouts = new Map<string, Handout>();
  private buffer: Out[] = [];
  private rollTimes = new Map<string, number[]>();

  private readonly rng: Rng;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly bufferSize: number;
  private readonly rollsPerSecond: number;

  constructor(roomId: string, opts: RoomOptions & { sessionNumber?: number } = {}) {
    this.roomId = roomId;
    this.sessionNumber = opts.sessionNumber ?? 0;
    this.rng = opts.rng ?? defaultRng;
    this.now = opts.now ?? Date.now;
    this.newId = opts.newId ?? (() => globalThis.crypto.randomUUID());
    this.bufferSize = opts.bufferSize ?? 500;
    this.rollsPerSecond = opts.rollsPerSecond ?? 5;
  }

  toData(): RoomData {
    return {
      roomId: this.roomId,
      seq: this.seq,
      status: this.status,
      ...(this.pauseReason ? { pauseReason: this.pauseReason } : {}),
      sessionNumber: this.sessionNumber,
      objects: [...this.objects.values()].map((o) => ({ ...o })),
      scenes: [...this.scenes.values()].map((sc) => this.sceneFor(sc, true)),
      activeSceneId: this.activeSceneId,
      effects: cloneEffects(this.effects),
      madnessTable: [...this.madnessTable],
      initiative: cloneInitiative(this.initiative),
      flow: cloneFlow(this.flow),
      audio: this.audio.map((t) => ({ ...t })),
      bgm: this.bgm ? { ...this.bgm } : null,
      members: this.memberList(),
      rolls: this.rolls.map((r) => ({ ...r })),
      characters: [...this.characters.values()].map(cloneCharacter),
      handouts: [...this.handouts.values()].map((h) => cloneHandout(h)),
    };
  }

  /**
   * 저장된 상태에서 룸을 되살린다. 서버가 내려갔다 올라온 경우 GM이 없으므로
   * 진행 중이던 세션은 자동 정지(kp_disconnected)로 두고, GM이 들어오면 자동 재개한다.
   * 저장 때 이미 정지였다면 사유를 그대로 따른다(옛 데이터는 GM이 누른 정지로 본다).
   */
  static fromData(data: RoomData, opts: RoomOptions = {}): Room {
    const room = new Room(data.roomId, { ...opts, sessionNumber: data.sessionNumber });
    room.seq = data.seq;
    room.status = data.status === "ACTIVE" ? "PAUSED" : data.status;
    room.pauseReason = room.status !== "PAUSED" ? null : data.status === "ACTIVE" ? "kp_disconnected" : (data.pauseReason ?? "kp_request");
    if (data.scenes?.length) {
      room.scenes = new Map(data.scenes.map((sc) => [sc.id, { ...sc }]));
      room.activeSceneId = room.scenes.has(data.activeSceneId ?? "") ? (data.activeSceneId as string) : data.scenes[0]!.id;
    }
    if (data.madnessTable) room.madnessTable = [...data.madnessTable];
    room.initiative = cloneInitiative(data.initiative ?? null);
    if (data.flow) room.flow = cloneFlow(data.flow);
    room.audio = (data.audio ?? []).map((t) => ({ ...t }));
    room.bgm = data.bgm ? { ...data.bgm } : null;
    if (data.effects) room.effects = cloneEffects({ ...DEFAULT_EFFECTS, ...data.effects });
    // 장면이 없던 옛 저장 데이터의 오브젝트는 기본 장면에 둔다.
    for (const o of data.objects) room.objects.set(o.id, { ...o, sceneId: o.sceneId ?? DEFAULT_SCENE_ID });
    for (const m of data.members) room.members.set(m.userId, { ...m, online: false });
    room.rolls = data.rolls.map((r) => ({ ...r }));
    for (const c of data.characters ?? []) room.characters.set(c.id, cloneCharacter(c));
    for (const h of data.handouts ?? []) room.handouts.set(h.id, cloneHandout(h));
    return room;
  }

  get sessionStatus(): SessionStatus {
    return this.status;
  }

  get currentSeq(): number {
    return this.seq;
  }

  // ── 접속 ───────────────────────────────────────────────

  /**
   * 접속. 처음이면 멤버를 만들고, 다시 접속이면 온라인으로 바꾼다.
   * GM이 돌아오면 유예를 끝내고, 자동 정지(kp_disconnected) 상태였다면 자동으로 재개한다.
   */
  join(actor: Actor): Out[] {
    const prev = this.members.get(actor.userId);
    this.members.set(actor.userId, { userId: actor.userId, name: actor.name, role: actor.role, online: true });
    const out: Out[] = [];
    if (!(prev && prev.online && prev.role === actor.role && prev.name === actor.name)) {
      out.push(this.emit({ type: "presence", data: { members: this.memberList() } }, { roles: ALL_ROLES }));
    }
    if (actor.role === "kp") {
      if (this.kpAwaySince !== null) {
        this.kpAwaySince = null;
        out.push(this.emit({ type: "kp.back", data: {} }, { roles: ALL_ROLES }));
      }
      if (this.status === "PAUSED" && this.pauseReason === "kp_disconnected") {
        this.status = "ACTIVE";
        this.pauseReason = null;
        out.push(this.emit({ type: "session.resumed", data: {} }, { roles: ALL_ROLES }));
      }
    }
    return out;
  }

  /**
   * 한 사용자의 마지막 연결이 닫혔을 때 부른다. GM이었고 진행 중이면 바로 멈추지 않고 유예를 시작한다
   * (kp.away). 유예가 지나도 안 돌아오면 호출자가 expireKpAway()를 부른다. 시계는 호출자의 몫이다.
   */
  leave(userId: string): Out[] {
    const m = this.members.get(userId);
    if (!m || !m.online) return [];
    m.online = false;
    const out: Out[] = [this.emit({ type: "presence", data: { members: this.memberList() } }, { roles: ALL_ROLES })];
    if (m.role === "kp" && this.status === "ACTIVE" && !this.kpOnline()) {
      this.kpAwaySince = this.now();
      out.push(this.emit({ type: "kp.away", data: { since: this.kpAwaySince } }, { roles: ALL_ROLES }));
    }
    return out;
  }

  /** 유예가 끝났을 때 부른다. 아직 GM이 없고 진행 중이면 자동 정지(kp_disconnected)한다. */
  expireKpAway(): Out[] {
    if (this.kpAwaySince === null) return [];
    this.kpAwaySince = null;
    if (this.status !== "ACTIVE" || this.kpOnline()) return [];
    this.status = "PAUSED";
    this.pauseReason = "kp_disconnected";
    return [this.emit({ type: "session.paused", data: { reason: "kp_disconnected" } }, { roles: ALL_ROLES })];
  }

  get kpAway(): number | null {
    return this.kpAwaySince;
  }

  private kpOnline(): boolean {
    return [...this.members.values()].some((m) => m.role === "kp" && m.online);
  }

  // ── 조회 ───────────────────────────────────────────────

  snapshot(viewer: Pick<Member, "userId" | "role">): Snapshot {
    return {
      roomId: this.roomId,
      seq: this.seq,
      sessionStatus: this.status,
      pauseReason: this.status === "PAUSED" ? this.pauseReason : null,
      kpAwaySince: this.kpAwaySince,
      sessionNumber: this.sessionNumber,
      objects: [...this.objects.values()].filter((o) => this.visibleTo(o, viewer)).map((o) => ({ ...o })),
      scenes: [...this.scenes.values()].filter((sc) => viewer.role === "kp" || sc.id === this.activeSceneId).map((sc) => this.sceneFor(sc, viewer.role === "kp")),
      activeSceneId: this.activeSceneId,
      effects: cloneEffects(this.effects),
      madnessTable: viewer.role === "kp" ? [...this.madnessTable] : [],
      initiative: this.initiativeFor(viewer),
      flow: viewer.role === "kp" ? cloneFlow(this.flow) : null,
      audioLibrary: viewer.role === "kp" ? this.audio.map((t) => ({ ...t })) : [],
      bgm: this.bgm ? { ...this.bgm } : null,
      now: this.now(),
      members: this.memberList(),
      rolls: this.rolls.filter((r) => !r.secret || viewer.role === "kp").map((r) => ({ ...r })),
      characters: [...this.characters.values()].filter((c) => canSeeCharacter(c, viewer)).map(cloneCharacter),
      handouts: [...this.handouts.values()].filter((h) => canSeeHandout(h, viewer)).map((h) => cloneHandout(h)),
    };
  }

  /**
   * 끊긴 구간의 이벤트. 버퍼에 남아 있지 않으면 null이고,
   * 이때는 snapshot으로 다시 맞춰야 한다.
   */
  eventsSince(viewer: Pick<Member, "userId" | "role">, lastSeq: number): Out[] | null {
    if (lastSeq > this.seq) return null;
    if (lastSeq === this.seq) return [];
    const oldest = this.buffer[0]?.seq;
    if (oldest === undefined || lastSeq < oldest - 1) return null;
    return this.buffer.filter((o) => o.seq > lastSeq && inAudience(o.audience, viewer));
  }

  // ── 명령 처리 ───────────────────────────────────────────

  handle(actor: Actor, command: ClientCommand): Result {
    const sceneBefore = this.activeSceneId;
    this.fogBefore = this.fogAreas();
    this.fanned = new Set();
    this.exploredChanged = false;
    const pending = this.members.get(actor.userId)?.role === "kp" ? this.undoLog.capture(command, this.undoMaps()) : null;
    const first = this.dispatch(actor, command);
    if (first.ok && sceneBefore === this.activeSceneId) this.recordExplored();
    if (first.ok && pending) this.undoLog.commit(pending, this.undoMaps());
    // 안개 안의 오브젝트는 시야가 바뀌면 다른 오브젝트도 새로 보이거나 사라진다.
    const r = first.ok && sceneBefore === this.activeSceneId ? this.withFogDiff(first) : first;
    if (!r.ok || this.flow.current === null) return r;
    const extra = this.flowSuggest(r.out);
    return extra.length ? ok(...r.out, ...extra) : r;
  }

  /** 이번 명령 전의 안개 원들과, 이번 명령에서 이미 알린 오브젝트 */
  private fogBefore: FogArea[] | undefined;
  /** 이번 명령으로 탐험 기록이 늘었는지 */
  private exploredChanged = false;
  private fanned = new Set<string>();
  /** GM의 최근 변경 기록(되돌리기용). 메모리에만 둔다. */
  private readonly undoLog = new UndoLog();

  private dispatch(actor: Actor, command: ClientCommand): Result {
    const member = this.members.get(actor.userId);
    if (!member) return fail("forbidden", "룸에 참가하지 않은 사용자예요.");
    // 역할은 서버가 가진 값을 믿는다. 요청에 실린 값은 쓰지 않는다.
    const who: Actor = { userId: member.userId, name: member.name, role: member.role };

    switch (command.type) {
      case "session.start":
        return this.sessionStart(who);
      case "session.pause":
        return this.sessionPause(who);
      case "session.resume":
        return this.sessionResume(who);
      case "session.end":
        return this.sessionEnd(who, command.data);
    }

    if (this.status === "PAUSED") {
      if (who.role !== "kp") {
        return fail("paused", this.pauseReason === "kp_request" ? "세션이 일시정지 중이에요. GM이 이어하기를 누르면 계속돼요." : "세션이 일시정지 중이에요. GM이 돌아오면 이어서 진행해요.");
      }
      // GM은 준비성 명령(편집)만 할 수 있다. 판정과 전투, 이야기를 앞으로 미는 명령은 이어하기 뒤에 한다.
      if (KP_BLOCKED_WHILE_PAUSED.has(command.type)) return fail("paused", "일시정지 중에는 판정·전투·장면 전환을 할 수 없어요. 이어하기를 눌러 주세요.");
    }
    // 세션이 없을 때는 GM만 장면을 준비할 수 있다(준비 모드).
    // 캐릭터 등록은 세션 전에도 할 수 있다(미리 불러오기).
    // 시트의 글(소지품·인물 배경·메모)은 세션 전에도 PL이 미리 채울 수 있다. 수치·판정은 세션이 열려야 한다.
    const textOnlyPatch = command.type === "sheet.patch" && command.data.ops.every((o) => o.path === "notes" || o.path === "possessions" || o.path === "backstory");
    if (this.status === "IDLE" && who.role !== "kp" && command.type !== "character.add" && command.type !== "character.remove" && !textOnlyPatch) return fail("idle", "아직 세션이 시작되지 않았어요.");

    switch (command.type) {
      case "settings.effects":
        return this.setEffect(who, command.data);
      case "scene.create":
        return this.sceneCreate(who, command.data.name);
      case "scene.setStart":
        return this.sceneSetStart(who, command.data.id);
      case "scene.background":
        return this.sceneBackground(who, command.data);
      case "scene.setBgm":
        return this.sceneSetBgm(who, command.data);
      case "scene.fog":
        return this.sceneFog(who, command.data);
      case "fog.reveal":
        return this.fogReveal(who, command.data);
      case "fog.remove":
        return this.fogRemove(who, command.data);
      case "fog.clear":
        return this.fogClear(who, command.data.sceneId);
      case "fog.forget":
        return this.fogForget(who, command.data.sceneId);
      case "scene.rename":
        return this.sceneRename(who, command.data);
      case "scene.remove":
        return this.sceneRemove(who, command.data.id);
      case "scene.activate":
        return this.sceneActivate(who, command.data);
      case "undo.last":
        return this.undoLast(who);
      case "object.add":
        return this.objectAdd(who, command.data);
      case "object.move":
        return this.objectMove(who, command.data);
      case "object.update":
        return this.objectUpdate(who, command.data);
      case "board.ping":
        return this.boardPing(who, command.data);
      case "object.remove":
        return this.objectRemove(who, command.data.id);
      case "roll.request":
        return this.rollRequest(who, command.data);
      case "roll.ask":
        return this.rollAsk(who, command.data);
      case "audio.track.add":
        return this.audioTrackAdd(who, command.data);
      case "audio.track.remove":
        return this.audioTrackRemove(who, command.data.id);
      case "audio.play":
        return this.audioPlay(who, command.data);
      case "audio.stop":
        return this.audioStop(who, command.data.fadeMs);
      case "audio.volume":
        return this.audioVolume(who, command.data.volume);
      case "flow.beat.upsert":
        return this.beatUpsert(who, command.data);
      case "flow.beat.remove":
        return this.beatRemove(who, command.data.id);
      case "flow.branch.upsert":
        return this.branchUpsert(who, command.data);
      case "flow.branch.remove":
        return this.branchRemove(who, command.data.id);
      case "flow.goto":
        return this.flowGoto(who, command.data.beatId, false);
      case "flow.ending.choose":
        return this.flowGoto(who, command.data.beatId, true);
      case "flow.dismiss":
        return this.flowDismiss(who, command.data.branchId);
      case "initiative.start":
        return this.initiativeStart(who);
      case "initiative.add":
        return this.initiativeAdd(who, command.data);
      case "initiative.remove":
        return this.initiativeRemove(who, command.data.id);
      case "initiative.dex":
        return this.initiativeDex(who, command.data);
      case "initiative.next":
        return this.initiativeNext(who);
      case "initiative.end":
        return this.initiativeEnd(who);
      case "settings.madness":
        return this.setMadnessTable(who, command.data.entries);
      case "madness.roll":
        return this.madnessRoll(who, command.data);
      case "damage.roll":
        return this.damageRoll(who, command.data);
      case "roll.push":
        return this.rollPush(who, command.data.rollId);
      case "luck.spend":
        return this.luckSpend(who, command.data.rollId);
      case "san.check":
        return this.sanCheck(who, command.data);
      case "san.newDay":
        return this.sanNewDay(who, command.data.characterId);
      case "handout.create":
        return this.handoutCreate(who, command.data);
      case "handout.update":
        return this.handoutUpdate(who, command.data);
      case "handout.remove":
        return this.handoutRemove(who, command.data.id);
      case "handout.show":
        return this.handoutShow(who, command.data.id, command.data.reveal === true);
      case "character.add":
        return this.characterAdd(who, command.data);
      case "character.remove":
        return this.characterRemove(who, command.data.id);
      case "sheet.patch":
        return this.sheetPatch(who, command.data);
    }
  }

  // ── 세션 ───────────────────────────────────────────────

  private sessionStart(who: Actor): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 세션을 시작할 수 있어요.");
    if (this.status !== "IDLE") return fail("bad_message", "이미 세션이 진행 중이에요.");
    this.sessionNumber += 1;
    this.status = "ACTIVE";
    this.pauseReason = null;
    const started = this.emit({ type: "session.started", data: { number: this.sessionNumber } }, { roles: ALL_ROLES });
    // 시작 비트가 있으면 그 큐를 실행하고 현재 비트로 둔다.
    const startBeat = this.flow.beats.find((b) => b.kind === "start");
    if (startBeat) {
      this.enterBeat(startBeat);
      return ok(started, ...this.runCue(who, startBeat), this.flowOut());
    }
    // 아니면 시작 장면을 정해 두었을 때 세션과 함께 그 장면을 연다.
    const start = [...this.scenes.values()].find((s) => s.start);
    if (start && start.id !== this.activeSceneId) return ok(started, ...this.activateScene(start, "cut"));
    return ok(started);
  }

  private sessionPause(who: Actor): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 세션을 멈출 수 있어요.");
    if (this.status !== "ACTIVE") return fail("bad_message", "진행 중인 세션이 아니에요.");
    this.status = "PAUSED";
    this.pauseReason = "kp_request";
    return ok(this.emit({ type: "session.paused", data: { reason: "kp_request" } }, { roles: ALL_ROLES }));
  }

  private sessionResume(who: Actor): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 세션을 이어갈 수 있어요.");
    if (this.status !== "PAUSED") return fail("bad_message", "일시정지 중인 세션이 없어요.");
    this.status = "ACTIVE";
    this.pauseReason = null;
    return ok(this.emit({ type: "session.resumed", data: {} }, { roles: ALL_ROLES }));
  }

  private sessionEnd(who: Actor, d: { ending?: string; sanReward?: string; growth?: boolean }): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 세션을 끝낼 수 있어요.");
    if (this.status === "IDLE") return fail("bad_message", "진행 중인 세션이 없어요.");
    // 보상 식은 상태를 바꾸기 전에 확인한다. 틀린 식 때문에 세션이 반쯤 끝나면 안 된다.
    if (d.sanReward) {
      const probe = parseSumExpression(d.sanReward);
      if (!probe.ok) return fail("bad_message", `SAN 보상은 1d6+1d4처럼 주사위 식으로 적어 주세요. ${probe.error}`);
    }

    // 엔딩 비트에서 끝내면 그 비트의 이름과 SAN 보상을 기본값으로 쓴다.
    const endBeat = this.flow.beats.find((b) => b.id === this.flow.current && b.kind === "ending");
    d = { ...d, ending: d.ending ?? endBeat?.name, sanReward: d.sanReward ?? endBeat?.sanReward };
    const summary: EndSummary = {};
    const outs: Out[] = [];
    if (d.ending) summary.ending = d.ending;
    if (d.sanReward) summary.sanRewards = [];
    if (d.growth) summary.growth = [];

    for (const c of this.characters.values()) {
      const next = cloneCharacter(c);
      let changed = false;

      if (d.sanReward) {
        const rolled = rollSumExpression(d.sanReward, this.rng);
        if (rolled.ok) {
          const before = next.san;
          next.san = clamp(before + rolled.outcome.total, 0, deriveCharacter(next).limits.san);
          summary.sanRewards?.push({ characterId: c.id, name: c.name, roll: rolled.outcome.total, before, after: next.san });
          changed = changed || next.san !== before;
        }
      }

      if (d.growth) {
        for (const [skill, entry] of Object.entries(next.skills)) {
          if (!entry.grown) continue;
          // 성장 굴림: d100이 현재값보다 크거나 96 이상이면 성공해 1d10을 올린다. 성공해도 실패해도 표시는 지운다.
          const roll = rollDie(this.rng, 100);
          const before = entry.value;
          const success = roll > before || roll > 95;
          if (success) entry.value = clamp(before + rollDie(this.rng, 10), 0, SKILL_CAP);
          entry.grown = false;
          summary.growth?.push({ characterId: c.id, name: c.name, skill, roll, before, after: entry.value, success });
          changed = true;
        }
      }

      if (changed) {
        next.rev = c.rev + 1;
        this.characters.set(c.id, next);
        outs.push(this.emit({ type: "character.updated", data: cloneCharacter(next) }, this.characterAudience(next)));
      }
    }

    this.status = "IDLE";
    this.pauseReason = null;
    this.kpAwaySince = null;
    // NPC 시트의 보상·성장 기록은 GM에게만 보여 준다.
    const forPl: EndSummary = { ...summary };
    const isNpc = (id: string) => {
      const c = this.characters.get(id);
      return !c || this.isNpcSheet(c);
    };
    if (summary.sanRewards) forPl.sanRewards = summary.sanRewards.filter((r) => !isNpc(r.characterId));
    if (summary.growth) forPl.growth = summary.growth.filter((g) => !isNpc(g.characterId));
    if (JSON.stringify(forPl) === JSON.stringify(summary)) {
      outs.push(this.emit({ type: "session.ended", data: summary }, { roles: ALL_ROLES }));
    } else {
      outs.push(this.emit({ type: "session.ended", data: summary }, { roles: ["kp"] }));
      outs.push(this.emit({ type: "session.ended", data: forPl }, { roles: ["pl", "spectator"] }));
    }
    return ok(...outs);
  }

  // ── 판정 효과 ───────────────────────────────────────────

  private setEffect(who: Actor, d: { level: keyof EffectSettings; enabled?: boolean; intensity?: 1 | 2 | 3 }): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 판정 효과를 바꿀 수 있어요.");
    const cur = this.effects[d.level];
    this.effects[d.level] = { enabled: d.enabled ?? cur.enabled, intensity: d.intensity ?? cur.intensity };
    return ok(this.emit({ type: "settings.effects", data: { effects: cloneEffects(this.effects) } }, { roles: ALL_ROLES }));
  }

  // ── 음향 ──────────────────────────────────────────────

  private audioGuard(who: Actor): Result | null {
    return who.role === "kp" ? null : fail("forbidden", "GM만 음향을 다룰 수 있어요.");
  }

  private libraryOut(): Out {
    return this.emit({ type: "audio.library", data: { tracks: this.audio.map((t) => ({ ...t })) } }, { roles: ["kp"] });
  }

  /** 트랙을 튼다. 배경음은 서버 시각을 기록해 늦게 온 사람도 같은 위치부터 듣게 하고, 효과음은 한 번 울리고 끝이다. */
  private startTrack(track: AudioTrack, volume: number, fadeMs: number): Out {
    const startedAt = this.now();
    if (track.kind === "bgm") this.bgm = { assetId: track.assetId, volume, startedAt, fadeMs };
    return this.emit(
      { type: "audio.play", data: { assetId: track.assetId, channel: track.kind, volume, loop: track.kind === "bgm", fadeMs, startedAt } },
      { roles: ALL_ROLES },
    );
  }

  private audioTrackAdd(who: Actor, d: { label: string; kind: "bgm" | "se"; assetId: string; volume: number }): Result {
    const denied = this.audioGuard(who);
    if (denied) return denied;
    if (this.audio.length >= MAX_AUDIO_TRACKS) return fail("bad_message", `음원은 ${MAX_AUDIO_TRACKS}개까지 둘 수 있어요.`);
    this.audio.push({ id: this.newId(), label: d.label, kind: d.kind, assetId: d.assetId, volume: d.volume });
    return ok(this.libraryOut());
  }

  private audioTrackRemove(who: Actor, id: string): Result {
    const denied = this.audioGuard(who);
    if (denied) return denied;
    if (!this.audio.some((t) => t.id === id)) return fail("not_found", "음원을 찾을 수 없어요.");
    this.audio = this.audio.filter((t) => t.id !== id);
    const out = [this.libraryOut()];
    // 장면이 가리키던 배경음이면 연결을 푼다.
    for (const sc of this.scenes.values()) {
      if (sc.bgmTrackId === id) {
        delete sc.bgmTrackId;
        out.push(...this.emitScene(sc));
      }
    }
    // 비트가 가리키던 배경음이면 연결을 푼다.
    let touched = false;
    for (const b of this.flow.beats) {
      if (b.bgmTrackId === id) {
        delete b.bgmTrackId;
        touched = true;
      }
    }
    if (touched) out.push(this.flowOut());
    return ok(...out);
  }

  private audioPlay(who: Actor, d: { trackId: string; volume?: number; fadeMs: number }): Result {
    const denied = this.audioGuard(who);
    if (denied) return denied;
    const track = this.audio.find((t) => t.id === d.trackId);
    if (!track) return fail("not_found", "음원을 찾을 수 없어요.");
    return ok(this.startTrack(track, d.volume ?? track.volume, d.fadeMs));
  }

  /** 흐르는 배경음이 있으면 멈추는 이벤트를 돌려준다(장면·비트의 '음악 정지'). */
  private stopBgm(fadeMs: number): Out[] {
    if (!this.bgm) return [];
    this.bgm = null;
    return [this.emit({ type: "audio.stopped", data: { fadeMs } }, { roles: ALL_ROLES })];
  }

  private audioStop(who: Actor, fadeMs: number): Result {
    const denied = this.audioGuard(who);
    if (denied) return denied;
    if (!this.bgm) return fail("bad_message", "흐르는 배경음이 없어요.");
    this.bgm = null;
    return ok(this.emit({ type: "audio.stopped", data: { fadeMs } }, { roles: ALL_ROLES }));
  }

  private audioVolume(who: Actor, volume: number): Result {
    const denied = this.audioGuard(who);
    if (denied) return denied;
    if (!this.bgm) return fail("bad_message", "흐르는 배경음이 없어요.");
    this.bgm.volume = volume;
    return ok(this.emit({ type: "audio.volume", data: { volume } }, { roles: ALL_ROLES }));
  }

  // ── 세션 흐름 ──────────────────────────────────────────

  private flowOut(): Out {
    return this.emit({ type: "flow.updated", data: { flow: cloneFlow(this.flow) } }, { roles: ["kp"] });
  }

  private flowGuard(who: Actor): Result | null {
    return who.role === "kp" ? null : fail("forbidden", "GM만 세션 흐름을 다룰 수 있어요.");
  }

  /** 비트에 들어간다: 현재 위치를 옮기고 제안을 비운다. */
  private enterBeat(beat: Beat) {
    this.flow.current = beat.id;
    this.flow.suggestions = [];
    this.dismissed.clear();
  }

  /** 비트의 큐: 장면을 바꾸고 공개된 핸드아웃을 펼친다. 초안 핸드아웃은 건너뛴다. */
  private runCue(who: Actor, beat: Beat): Out[] {
    const out: Out[] = [];
    const scene = beat.sceneId ? this.scenes.get(beat.sceneId) : undefined;
    if (scene && scene.id !== this.activeSceneId) out.push(...this.activateScene(scene, "cut"));
    for (const hid of beat.handoutIds) {
      const shown = this.handouts.has(hid) ? this.handoutShow(who, hid) : null;
      if (shown?.ok) out.push(...shown.out);
    }
    const track = beat.bgmTrackId ? this.audio.find((t) => t.id === beat.bgmTrackId && t.kind === "bgm") : undefined;
    if (track) out.push(this.startTrack(track, track.volume, 0));
    else if (beat.bgmTrackId === BGM_STOP) out.push(...this.stopBgm(1000));
    return out;
  }

  private beatUpsert(who: Actor, d: Extract<ClientCommand, { type: "flow.beat.upsert" }>["data"]): Result {
    const denied = this.flowGuard(who);
    if (denied) return denied;
    if (d.sceneId && !this.scenes.has(d.sceneId)) return fail("not_found", "장면을 찾을 수 없어요.");
    if (d.sanReward) {
      const probe = parseSumExpression(d.sanReward);
      if (!probe.ok) return fail("bad_message", `SAN 보상은 1d6+1d4처럼 주사위 식으로 적어 주세요. ${probe.error}`);
    }
    if (d.bgmTrackId && d.bgmTrackId !== BGM_STOP && this.audio.find((t) => t.id === d.bgmTrackId)?.kind !== "bgm") return fail("not_found", "배경음을 찾을 수 없어요.");
    if (d.handoutIds.some((hid) => this.handouts.get(hid)?.kpOnly)) return fail("bad_message", "GM 전용 노트는 비트에 붙일 수 없어요.");
    const existing = d.id ? this.flow.beats.find((b) => b.id === d.id) : undefined;
    if (d.id && !existing) return fail("not_found", "비트를 찾을 수 없어요.");
    if (!existing && this.flow.beats.length >= MAX_BEATS) return fail("bad_message", `비트는 ${MAX_BEATS}개까지 둘 수 있어요.`);
    const beat: Beat = {
      id: existing?.id ?? this.newId(),
      name: d.name,
      kind: d.kind,
      memo: d.memo,
      handoutIds: [...new Set(d.handoutIds)],
      ...(d.sceneId ? { sceneId: d.sceneId } : {}),
      ...(d.bgmTrackId ? { bgmTrackId: d.bgmTrackId } : {}),
      ...(d.sanReward && d.kind === "ending" ? { sanReward: d.sanReward } : {}),
    };
    // 시작 비트는 하나만 둔다. 새로 시작으로 정하면 이전 시작 비트는 진행 비트가 된다.
    if (beat.kind === "start") for (const b of this.flow.beats) if (b.kind === "start" && b.id !== beat.id) b.kind = "progress";
    if (existing) this.flow.beats[this.flow.beats.indexOf(existing)] = beat;
    else this.flow.beats.push(beat);
    return ok(this.flowOut());
  }

  private beatRemove(who: Actor, id: string): Result {
    const denied = this.flowGuard(who);
    if (denied) return denied;
    if (!this.flow.beats.some((b) => b.id === id)) return fail("not_found", "비트를 찾을 수 없어요.");
    this.flow.beats = this.flow.beats.filter((b) => b.id !== id);
    this.flow.branches = this.flow.branches.filter((b) => b.from !== id && b.to !== id);
    if (this.flow.current === id) this.flow.current = null;
    this.pruneSuggestions();
    return ok(this.flowOut());
  }

  private branchUpsert(who: Actor, d: Extract<ClientCommand, { type: "flow.branch.upsert" }>["data"]): Result {
    const denied = this.flowGuard(who);
    if (denied) return denied;
    if (!this.flow.beats.some((b) => b.id === d.from) || !this.flow.beats.some((b) => b.id === d.to)) return fail("not_found", "비트를 찾을 수 없어요.");
    if (d.from === d.to) return fail("bad_message", "같은 비트로 되돌아가는 분기는 만들 수 없어요.");
    if (d.condition.type === "handout" && !this.handouts.has(d.condition.handoutId)) return fail("not_found", "핸드아웃을 찾을 수 없어요.");
    if (d.condition.type === "handout" && this.handouts.get(d.condition.handoutId)?.kpOnly) return fail("bad_message", "GM 전용 노트는 분기 조건으로 쓸 수 없어요.");
    const existing = d.id ? this.flow.branches.find((b) => b.id === d.id) : undefined;
    if (d.id && !existing) return fail("not_found", "분기를 찾을 수 없어요.");
    if (!existing && this.flow.branches.length >= MAX_BRANCHES) return fail("bad_message", `분기는 ${MAX_BRANCHES}개까지 둘 수 있어요.`);
    const branch: Branch = { id: existing?.id ?? this.newId(), from: d.from, to: d.to, label: d.label, condition: d.condition };
    if (existing) this.flow.branches[this.flow.branches.indexOf(existing)] = branch;
    else this.flow.branches.push(branch);
    this.pruneSuggestions();
    return ok(this.flowOut());
  }

  private branchRemove(who: Actor, id: string): Result {
    const denied = this.flowGuard(who);
    if (denied) return denied;
    if (!this.flow.branches.some((b) => b.id === id)) return fail("not_found", "분기를 찾을 수 없어요.");
    this.flow.branches = this.flow.branches.filter((b) => b.id !== id);
    this.pruneSuggestions();
    return ok(this.flowOut());
  }

  /** 비트로 이동하고 큐를 실행한다. 엔딩 비트는 [엔딩 확정] 경로로만 간다. */
  private flowGoto(who: Actor, beatId: string, ending: boolean): Result {
    const denied = this.flowGuard(who);
    if (denied) return denied;
    if (this.status !== "ACTIVE") return fail("bad_message", "세션을 시작한 뒤에 옮길 수 있어요.");
    const beat = this.flow.beats.find((b) => b.id === beatId);
    if (!beat) return fail("not_found", "비트를 찾을 수 없어요.");
    if (ending && beat.kind !== "ending") return fail("bad_message", "엔딩 비트가 아니에요.");
    if (!ending && beat.kind === "ending") return fail("bad_message", "엔딩은 [엔딩 확정]으로 골라 주세요.");
    this.enterBeat(beat);
    return ok(...this.runCue(who, beat), this.flowOut());
  }

  private flowDismiss(who: Actor, branchId: string): Result {
    const denied = this.flowGuard(who);
    if (denied) return denied;
    if (!this.flow.suggestions.some((s) => s.branchId === branchId)) return fail("not_found", "제안을 찾을 수 없어요.");
    this.dismissed.add(branchId);
    this.flow.suggestions = this.flow.suggestions.filter((s) => s.branchId !== branchId);
    return ok(this.flowOut());
  }

  private pruneSuggestions() {
    const live = new Set(this.flow.branches.filter((b) => b.from === this.flow.current).map((b) => b.id));
    this.flow.suggestions = this.flow.suggestions.filter((s) => live.has(s.branchId));
  }

  /** 방금 일어난 일을 보고, 현재 비트에서 나가는 분기 중 조건이 맞은 것을 GM에게 제안한다. 스스로 옮기지는 않는다. */
  private flowSuggest(out: Out[]): Out[] {
    const flow = this.flow;
    let changed = false;
    for (const branch of flow.branches) {
      if (branch.from !== flow.current || branch.condition.type === "manual") continue;
      if (this.dismissed.has(branch.id) || flow.suggestions.some((s) => s.branchId === branch.id)) continue;
      const reason = this.branchReason(branch, out);
      if (!reason) continue;
      flow.suggestions.push({ branchId: branch.id, reason });
      changed = true;
    }
    return changed ? [this.flowOut()] : [];
  }

  private branchReason(branch: Branch, out: Out[]): string | null {
    const c = branch.condition;
    if (c.type === "roll") {
      for (const o of out) {
        const ev = o.event;
        // GM의 비밀 굴림은 제안에 쓰지 않는다.
        if (ev.type !== "roll.result" || ev.data.secret || ev.data.check?.name !== c.skill) continue;
        const outcome = ev.data.outcome;
        if (outcome.kind === "cc" && outcome.level && meetsDifficulty(outcome.level, c.atLeast)) return `${ev.data.label ?? c.skill} 판정이 ${DIFFICULTY_KO[c.atLeast]} 이상`;
      }
      return null;
    }
    if (c.type === "stat") {
      const key = c.stat;
      for (const ch of this.characters.values()) if (ch[key] <= c.atMost) return `${ch.name}의 ${josa(String(key.toUpperCase()), "이/가")} ${ch[key]}(기준 ${c.atMost} 이하)`;
      return null;
    }
    if (c.type === "handout") {
      const shown = out.some((o) => o.event.type === "handout.shown" && o.event.data.id === c.handoutId);
      return shown ? `핸드아웃 ${josa(`'${this.handouts.get(c.handoutId)?.title ?? "?"}'`, "을/를")} 공개함` : null;
    }
    return null;
  }

  // ── 전투 순서 ──────────────────────────────────────────

  private initiativeOut(): Result {
    const full = cloneInitiative(this.initiative);
    const masked = this.initiativeFor({ role: "pl", userId: "" });
    // 가릴 칸이 없으면 모두에게 한 번만 보낸다.
    if (JSON.stringify(full) === JSON.stringify(masked)) return ok(this.emit({ type: "initiative.updated", data: { initiative: full } }, { roles: ALL_ROLES }));
    return ok(
      this.emit({ type: "initiative.updated", data: { initiative: full } }, { roles: ["kp"] }),
      this.emit({ type: "initiative.updated", data: { initiative: masked } }, { roles: ["pl", "spectator"] }),
    );
  }

  /**
   * 보는 사람에게 보여 줄 전투 순서. GM은 전부, 나머지는 GM만 쓰는 시트(NPC)의 칸을
   * 이름·DEX·시트 연결 없이 자리만 남겨 받는다(차례 위치는 그대로라 순서는 알 수 있다).
   */
  private initiativeFor(viewer: Pick<Member, "userId" | "role">): Initiative | null {
    if (!this.initiative) return null;
    if (viewer.role === "kp") return cloneInitiative(this.initiative);
    const copy = cloneInitiative(this.initiative)!;
    copy.entries = copy.entries.map((e) => {
      const c = e.characterId ? this.characters.get(e.characterId) : undefined;
      if (!c || !this.isNpcSheet(c)) return e;
      return { id: e.id, name: "알 수 없는 상대", dex: 0, hidden: true };
    });
    return copy;
  }

  /** PL이 주인이 아닌 시트(GM이 만든 NPC 시트 등). 이런 시트의 이름·DEX·보상 기록은 PL에게 보내지 않는다. */
  private isNpcSheet(c: Pick<Character, "ownerId">): boolean {
    return this.members.get(c.ownerId)?.role !== "pl";
  }

  private initiativeGuard(who: Actor): Result | null {
    if (who.role !== "kp") return fail("forbidden", "GM만 전투 순서를 다룰 수 있어요.");
    return null;
  }

  /** 룸의 모든 캐릭터를 DEX 높은 순으로 세워 새 전투를 연다. 같은 DEX는 먼저 등록한 쪽이 앞이다. */
  private initiativeStart(who: Actor): Result {
    const denied = this.initiativeGuard(who);
    if (denied) return denied;
    const entries: InitiativeEntry[] = [...this.characters.values()]
      .slice(0, MAX_INITIATIVE_ENTRIES)
      .map((c) => ({ id: this.newId(), name: c.name, dex: c.characteristics.DEX, characterId: c.id, ...(c.ownerId ? { ownerId: c.ownerId } : {}) }));
    this.initiative = { entries: sortByDex(entries), turn: 0, round: 1 };
    return this.initiativeOut();
  }

  private initiativeAdd(who: Actor, d: { name: string; dex: number }): Result {
    const denied = this.initiativeGuard(who);
    if (denied) return denied;
    if (!this.initiative) return fail("bad_message", "진행 중인 전투가 없어요. 먼저 전투를 시작해 주세요.");
    if (this.initiative.entries.length >= MAX_INITIATIVE_ENTRIES) return fail("bad_message", `전투 순서는 ${MAX_INITIATIVE_ENTRIES}명까지 둘 수 있어요.`);
    const current = this.initiative.entries[this.initiative.turn]?.id;
    this.initiative.entries = sortByDex([...this.initiative.entries, { id: this.newId(), name: d.name, dex: d.dex }]);
    this.keepTurn(current);
    return this.initiativeOut();
  }

  private initiativeRemove(who: Actor, id: string): Result {
    const denied = this.initiativeGuard(who);
    if (denied) return denied;
    const init = this.initiative;
    const idx = init?.entries.findIndex((e) => e.id === id) ?? -1;
    if (!init || idx < 0) return fail("not_found", "전투 순서에서 찾을 수 없어요.");
    init.entries.splice(idx, 1);
    if (idx < init.turn) init.turn -= 1;
    else if (idx === init.turn && init.turn >= init.entries.length) {
      // 마지막 차례였다면 다음 라운드 첫 칸으로 넘어간다.
      init.turn = 0;
      init.round += 1;
    }
    return this.initiativeOut();
  }

  private initiativeDex(who: Actor, d: { id: string; dex: number }): Result {
    const denied = this.initiativeGuard(who);
    if (denied) return denied;
    const init = this.initiative;
    const entry = init?.entries.find((e) => e.id === d.id);
    if (!init || !entry) return fail("not_found", "전투 순서에서 찾을 수 없어요.");
    const current = init.entries[init.turn]?.id;
    entry.dex = d.dex;
    init.entries = sortByDex(init.entries);
    this.keepTurn(current);
    return this.initiativeOut();
  }

  private initiativeNext(who: Actor): Result {
    const denied = this.initiativeGuard(who);
    if (denied) return denied;
    const init = this.initiative;
    if (!init || init.entries.length === 0) return fail("bad_message", "넘길 차례가 없어요.");
    init.turn += 1;
    if (init.turn >= init.entries.length) {
      init.turn = 0;
      init.round += 1;
    }
    return this.initiativeOut();
  }

  private initiativeEnd(who: Actor): Result {
    const denied = this.initiativeGuard(who);
    if (denied) return denied;
    if (!this.initiative) return fail("bad_message", "진행 중인 전투가 없어요.");
    this.initiative = null;
    return this.initiativeOut();
  }

  /** 순서가 바뀐 뒤에도 지금 차례인 사람이 그대로 지금 차례가 되게 한다. */
  private keepTurn(currentId: string | undefined) {
    const init = this.initiative;
    if (!init || !currentId) return;
    const at = init.entries.findIndex((e) => e.id === currentId);
    if (at >= 0) init.turn = at;
  }

  // ── 장면 ───────────────────────────────────────────────

  private sceneCreate(who: Actor, name: string): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 장면을 만들 수 있어요.");
    if (this.scenes.size >= MAX_SCENES) return fail("bad_message", `장면은 ${MAX_SCENES}개까지 둘 수 있어요.`);
    const scene: Scene = { id: this.newId(), name };
    this.scenes.set(scene.id, scene);
    return ok(this.emit({ type: "scene.added", data: { ...scene } }, { roles: ["kp"] }));
  }

  private sceneRename(who: Actor, d: { id: string; name: string }): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 장면 이름을 바꿀 수 있어요.");
    const scene = this.scenes.get(d.id);
    if (!scene) return fail("not_found", "장면을 찾을 수 없어요.");
    scene.name = d.name;
    // 지금 보고 있는 장면의 이름은 모두가 알고 있으니 함께 알린다.
    return ok(...this.emitScene(scene));
  }

  private sceneBackground(who: Actor, d: { id: string; image: string | null }): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 장면 배경을 바꿀 수 있어요.");
    const scene = this.scenes.get(d.id);
    if (!scene) return fail("not_found", "장면을 찾을 수 없어요.");
    if (d.image) scene.background = d.image;
    else delete scene.background;
    return ok(...this.emitScene(scene));
  }

  // ── 안개와 시야 ─────────────────────────────────────────

  /** 장면에서 지금 보이는 원들: 밝힌 영역과 시야 토큰의 둘레. 안개가 꺼져 있으면 undefined. */
  private fogAreas(sceneId: string = this.activeSceneId): FogArea[] | undefined {
    const scene = this.scenes.get(sceneId);
    if (!scene?.fog?.enabled) return undefined;
    const areas: FogArea[] = scene.fog.zones.map((z) => ({ x: z.x, y: z.y, r: z.r }));
    // 숨긴 토큰(GM 층·일부에게만 공개)의 시야 원은 PL에게 보내면 위치가 드러나므로 밝히지 않는다.
    for (const o of this.objects.values()) {
      if (o.sceneId === sceneId && o.vision && o.layer !== "gm" && o.visibleTo === "all") areas.push({ x: o.x, y: o.y, r: o.vision });
    }
    return areas;
  }

  /** 안개 때문에 보이는지. GM과 자기 토큰은 늘 보이고, 나머지는 원 안에 있어야 한다. */
  private passesFog(obj: GameObject, m: Pick<Member, "userId" | "role">, areas: FogArea[] | undefined): boolean {
    if (m.role === "kp" || !areas) return true;
    if (obj.ownerId === m.userId) return true;
    // 파티원(PL 소유 토큰)은 안개와 상관없이 다른 PL에게도 보인다. 숨기려면 GM이 토큰을 숨긴다.
    if (obj.kind === "token" && obj.ownerId && m.role === "pl") return true;
    return areas.some((a) => (a.x - obj.x) ** 2 + (a.y - obj.y) ** 2 <= a.r ** 2);
  }

  private visibleTo(obj: GameObject, m: Pick<Member, "userId" | "role">): boolean {
    return canSee(obj, m, this.activeSceneId) && this.passesFog(obj, m, this.fogAreas(obj.sceneId));
  }

  /** 시야가 바뀐 만큼 다른 오브젝트가 새로 보이거나 사라지는 이벤트와, 바뀐 원들을 덧붙인다. */
  private withFogDiff(first: Extract<Result, { ok: true }>): Result {
    const after = this.fogAreas();
    const before = this.fogBefore;
    if (!before && !after) return first;
    const out = [...first.out];
    for (const m of this.members.values()) {
      if (m.role === "kp") continue;
      const added: GameObject[] = [];
      const removed: string[] = [];
      for (const o of this.objects.values()) {
        if (this.fanned.has(o.id) || !canSee(o, m, this.activeSceneId)) continue;
        const was = this.passesFog(o, m, before);
        const now = this.passesFog(o, m, after);
        if (!was && now) added.push({ ...o });
        else if (was && !now) removed.push(o.id);
      }
      for (const o of added) out.push(this.emit({ type: "object.added", data: o }, { users: [m.userId] }));
      for (const id of removed) out.push(this.emit({ type: "object.removed", data: { id } }, { users: [m.userId] }));
    }
    const changed = JSON.stringify(before ?? null) !== JSON.stringify(after ?? null);
    const told = out.some((o) => o.event.type === "scene.updated" && o.audience.roles?.includes("pl"));
    const scene = this.scenes.get(this.activeSceneId);
    if (scene && ((changed && !told) || this.exploredChanged)) out.push(this.emit({ type: "scene.updated", data: this.sceneFor(scene, false) }, { roles: ["pl", "spectator"] }));
    // 탐험 기록은 GM 화면에도 보여 준다.
    if (scene && this.exploredChanged) out.push(this.emit({ type: "scene.updated", data: this.sceneFor(scene, true) }, { roles: ["kp"] }));
    return ok(...out);
  }

  /** 장면을 내보낼 모양으로 만든다. GM은 안개 설정 전체를, 나머지는 지금 보이는 원들만 받는다. */
  private sceneFor(scene: Scene, forKp: boolean): Scene {
    if (forKp) {
      const { fog, ...rest } = scene;
      return { ...rest, ...(fog ? { fog: { enabled: fog.enabled, zones: fog.zones.map((z) => ({ ...z })), ...(fog.explored ? { explored: fog.explored.map((a) => ({ ...a })) } : {}) } } : {}) };
    }
    const pub = publicScene(scene);
    const areas = scene.id === this.activeSceneId ? this.fogAreas(scene.id) : undefined;
    if (!areas) return pub;
    return { ...pub, fogAreas: areas, fogExplored: (scene.fog?.explored ?? []).map((a) => ({ ...a })) };
  }

  /**
   * 지금 보이는 원들을 탐험 기록에 더한다. 이미 기록된 원에 (조금의 오차 안에서) 들어가는 원은 더하지 않고,
   * 새 원이 기존 원을 통째로 덮으면 기존 원은 지운다. 안개가 꺼진 장면에서는 쌓지 않는다.
   */
  private recordExplored(): void {
    const scene = this.scenes.get(this.activeSceneId);
    const areas = this.fogAreas();
    if (!scene?.fog || !areas) return;
    const ex = (scene.fog.explored ??= []);
    const SLACK = 8;
    for (const a of areas) {
      const q = { x: Math.round(a.x), y: Math.round(a.y), r: Math.ceil(a.r) };
      if (ex.some((e) => Math.hypot(e.x - q.x, e.y - q.y) + q.r <= e.r + SLACK)) continue;
      for (let i = ex.length - 1; i >= 0; i--) if (Math.hypot(ex[i]!.x - q.x, ex[i]!.y - q.y) + ex[i]!.r <= q.r) ex.splice(i, 1);
      ex.push(q);
      if (ex.length > MAX_FOG_EXPLORED) ex.splice(0, ex.length - MAX_FOG_EXPLORED);
      this.exploredChanged = true;
    }
    if (ex.length === 0) delete scene.fog.explored;
  }

  private fogForget(who: Actor, sceneId: string): Result {
    const g = this.fogGuard(who, sceneId);
    if ("error" in g) return g.error;
    if (!g.scene.fog?.explored?.length) return fail("bad_message", "지울 탐험 기록이 없어요.");
    delete g.scene.fog.explored;
    return ok(...this.emitScene(g.scene));
  }

  private fogGuard(who: Actor, sceneId: string): { error: Result } | { scene: Scene } {
    if (who.role !== "kp") return { error: fail("forbidden", "GM만 안개를 다룰 수 있어요.") };
    const scene = this.scenes.get(sceneId);
    if (!scene) return { error: fail("not_found", "장면을 찾을 수 없어요.") };
    return { scene };
  }

  private sceneFog(who: Actor, d: { id: string; enabled: boolean }): Result {
    const g = this.fogGuard(who, d.id);
    if ("error" in g) return g.error;
    g.scene.fog = { ...g.scene.fog, enabled: d.enabled, zones: g.scene.fog?.zones ?? [] };
    return ok(...this.emitScene(g.scene));
  }

  private fogReveal(who: Actor, d: { sceneId: string; x: number; y: number; r: number }): Result {
    const g = this.fogGuard(who, d.sceneId);
    if ("error" in g) return g.error;
    const fog = (g.scene.fog ??= { enabled: false, zones: [] });
    if (fog.zones.length >= MAX_FOG_ZONES) return fail("bad_message", `밝힌 영역은 ${MAX_FOG_ZONES}개까지 둘 수 있어요.`);
    fog.zones.push({ id: this.newId(), x: d.x, y: d.y, r: d.r });
    return ok(...this.emitScene(g.scene));
  }

  private fogRemove(who: Actor, d: { sceneId: string; zoneId: string }): Result {
    const g = this.fogGuard(who, d.sceneId);
    if ("error" in g) return g.error;
    const fog = g.scene.fog;
    if (!fog?.zones.some((z) => z.id === d.zoneId)) return fail("not_found", "밝힌 영역을 찾을 수 없어요.");
    fog.zones = fog.zones.filter((z) => z.id !== d.zoneId);
    return ok(...this.emitScene(g.scene));
  }

  private fogClear(who: Actor, sceneId: string): Result {
    const g = this.fogGuard(who, sceneId);
    if ("error" in g) return g.error;
    if (!g.scene.fog || g.scene.fog.zones.length === 0) return fail("bad_message", "지울 영역이 없어요.");
    g.scene.fog.zones = [];
    return ok(...this.emitScene(g.scene));
  }

  /** 장면에 배경음을 묶는다(장면 묶음). null이면 푼다. */
  private sceneSetBgm(who: Actor, d: { id: string; trackId: string | null }): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 장면 배경음을 정할 수 있어요.");
    const scene = this.scenes.get(d.id);
    if (!scene) return fail("not_found", "장면을 찾을 수 없어요.");
    if (d.trackId === BGM_STOP) scene.bgmTrackId = BGM_STOP;
    else if (d.trackId) {
      if (this.audio.find((t) => t.id === d.trackId)?.kind !== "bgm") return fail("not_found", "배경음을 찾을 수 없어요.");
      scene.bgmTrackId = d.trackId;
    } else delete scene.bgmTrackId;
    return ok(...this.emitScene(scene));
  }

  /** GM에게는 전체를, 지금 장면이면 나머지에게는 GM 전용 표시를 뺀 값을 알린다. */
  private emitScene(scene: Scene): Out[] {
    const out = [this.emit({ type: "scene.updated", data: this.sceneFor(scene, true) }, { roles: ["kp"] })];
    if (scene.id === this.activeSceneId) out.push(this.emit({ type: "scene.updated", data: this.sceneFor(scene, false) }, { roles: ["pl", "spectator"] }));
    return out;
  }

  /** 세션을 시작할 때 처음 보일 장면을 하나 정한다. null이면 지정을 푼다. */
  private sceneSetStart(who: Actor, id: string | null): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 시작 장면을 정할 수 있어요.");
    if (id !== null && !this.scenes.has(id)) return fail("not_found", "장면을 찾을 수 없어요.");
    const out: Out[] = [];
    for (const s of this.scenes.values()) {
      const want = s.id === id;
      if (!!s.start === want) continue;
      if (want) s.start = true;
      else delete s.start;
      out.push(...this.emitScene(s));
    }
    return ok(...out);
  }

  private sceneRemove(who: Actor, id: string): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 장면을 지울 수 있어요.");
    if (!this.scenes.has(id)) return fail("not_found", "장면을 찾을 수 없어요.");
    if (id === this.activeSceneId) return fail("bad_message", "지금 진행 중인 장면은 지울 수 없어요. 다른 장면으로 바꾼 뒤 지워 주세요.");
    this.scenes.delete(id);
    for (const [oid, o] of this.objects) if (o.sceneId === id) this.objects.delete(oid);
    // 지우는 장면은 PL이 볼 수 없는 장면이라 GM에게만 알린다. 오브젝트는 클라이언트가 장면과 함께 정리한다.
    return ok(this.emit({ type: "scene.removed", data: { id } }, { roles: ["kp"] }));
  }

  /** 활성 장면을 바꾼다. PL에게는 새 장면에서 보이는 오브젝트 전체를 사람마다 따로 보낸다. */
  private sceneActivate(who: Actor, d: { id: string; transition: Transition; bringParty?: boolean }): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 장면을 바꿀 수 있어요.");
    const scene = this.scenes.get(d.id);
    if (!scene) return fail("not_found", "장면을 찾을 수 없어요.");
    if (d.id === this.activeSceneId) return fail("bad_message", "이미 진행 중인 장면이에요.");
    return ok(...this.activateScene(scene, d.transition, d.bringParty !== false));
  }

  /**
   * 새 장면에 토큰이 없는 PL에게는 이전 장면의 토큰을 빈자리에 복사해 둔다(이름·이미지·시야를 이어받는다).
   * 장면이 활성이 되기 전에 만들어서, 이 추가는 GM에게만 알림이 가고 PL에게는 scene.activated의 목록으로 간다.
   */
  private bringPartyTokens(scene: Scene): Out[] {
    const out: Out[] = [];
    const have = new Set([...this.objects.values()].filter((o) => o.sceneId === scene.id && o.kind === "token" && o.ownerId).map((o) => o.ownerId));
    const sources = new Map<string, GameObject>();
    for (const o of this.objects.values()) {
      if (o.kind !== "token" || !o.ownerId || o.sceneId === scene.id || have.has(o.ownerId)) continue;
      if (this.members.get(o.ownerId)?.role !== "pl") continue;
      if (o.sceneId === this.activeSceneId || !sources.has(o.ownerId)) sources.set(o.ownerId, o);
    }
    for (const src of sources.values()) {
      if (this.objects.size >= MAX_OBJECTS) break;
      const spot = this.freeSpot(scene.id, 500, 400);
      const obj: GameObject = {
        id: this.newId(),
        sceneId: scene.id,
        kind: "token",
        name: src.name,
        x: spot.x,
        y: spot.y,
        layer: src.layer,
        visibleTo: "all",
        locked: false,
        rev: 0,
        ownerId: src.ownerId!,
        ...(src.image ? { image: src.image } : {}),
        ...(src.vision ? { vision: src.vision } : {}),
      };
      this.objects.set(obj.id, obj);
      out.push(...this.fanOutObject(null, obj));
    }
    return out;
  }

  private activateScene(scene: Scene, transition: Transition, bringParty = true): Out[] {
    const out: Out[] = bringParty ? this.bringPartyTokens(scene) : [];
    this.activeSceneId = scene.id;
    for (const m of this.members.values()) {
      const data: Extract<Out["event"], { type: "scene.activated" }>["data"] = { scene: this.sceneFor(scene, m.role === "kp"), transition };
      if (m.role !== "kp") {
        data.objects = [...this.objects.values()].filter((o) => this.visibleTo(o, m)).map((o) => ({ ...o }));
      }
      out.push(this.emit({ type: "scene.activated", data }, { users: [m.userId] }));
    }
    // 장면에 묶은 배경음. 이미 같은 곡이 흐르고 있으면 끊지 않고 그대로 둔다.
    const track = scene.bgmTrackId ? this.audio.find((t) => t.id === scene.bgmTrackId && t.kind === "bgm") : undefined;
    if (track && this.bgm?.assetId !== track.assetId) out.push(this.startTrack(track, track.volume, transition === "fade" ? 1500 : 0));
    else if (scene.bgmTrackId === BGM_STOP) out.push(...this.stopBgm(transition === "fade" ? 1500 : 600));
    return out;
  }

  // ── 오브젝트 ────────────────────────────────────────────

  private objectAdd(who: Actor, d: Extract<ClientCommand, { type: "object.add" }>["data"]): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 오브젝트를 추가할 수 있어요.");
    if (this.objects.size >= MAX_OBJECTS) return fail("bad_message", `오브젝트는 ${MAX_OBJECTS}개까지 둘 수 있어요.`);
    const sceneId = d.sceneId ?? this.activeSceneId;
    if (!this.scenes.has(sceneId)) return fail("not_found", "장면을 찾을 수 없어요.");
    if (d.ownerId && this.members.get(d.ownerId)?.role !== "pl") return fail("bad_message", "소유자는 룸의 PL이어야 해요.");
    const spot = d.autoPlace ? this.freeSpot(sceneId, d.x, d.y) : { x: d.x, y: d.y };
    const obj: GameObject = {
      id: this.newId(),
      sceneId,
      kind: d.kind,
      name: d.name,
      x: spot.x,
      y: spot.y,
      layer: d.layer,
      visibleTo: d.visibleTo,
      locked: false,
      rev: 0,
      ...(d.ownerId ? { ownerId: d.ownerId } : {}),
      ...(d.image ? { image: d.image } : {}),
    };
    this.objects.set(obj.id, obj);
    return ok(...this.fanOutObject(null, obj));
  }

  /** 같은 장면의 오브젝트와 겹치지 않는, (x,y)에 가장 가까운 격자 자리. 빈자리가 없으면 그대로 돌려준다. */
  private freeSpot(sceneId: string, x: number, y: number): { x: number; y: number } {
    const STEP = 56;
    const others = [...this.objects.values()].filter((o) => o.sceneId === sceneId);
    const free = (px: number, py: number) => others.every((o) => (o.x - px) ** 2 + (o.y - py) ** 2 >= STEP * STEP);
    const inBoard = (px: number, py: number) => px >= 30 && px <= 970 && py >= 30 && py <= 770;
    const cands: { x: number; y: number; d: number }[] = [];
    for (let i = -12; i <= 12; i++) {
      for (let j = -12; j <= 12; j++) {
        const px = x + i * STEP;
        const py = y + j * STEP;
        if (inBoard(px, py)) cands.push({ x: px, y: py, d: i * i + j * j });
      }
    }
    cands.sort((a, b) => a.d - b.d);
    const hit = cands.find((c) => free(c.x, c.y));
    return hit ? { x: hit.x, y: hit.y } : { x, y };
  }

  /** 보드를 가리키는 일회성 신호. 저장·버퍼에 남기지 않는다. */
  private boardPing(who: Actor, d: { sceneId: string; x: number; y: number }): Result {
    if (who.role === "spectator") return fail("forbidden", "관전자는 가리킬 수 없어요.");
    if (d.sceneId !== this.activeSceneId) return fail("bad_message", "지금 진행 중인 장면이 아니에요.");
    if (this.tooMany(`ping:${who.userId}`, PINGS_PER_SECOND)) return fail("rate_limited", "너무 빨리 가리키고 있어요. 잠시 뒤에 다시 해 주세요.");
    const x = Math.max(0, Math.min(1000, d.x));
    const y = Math.max(0, Math.min(800, d.y));
    const users = pingRecipients(this.members.values(), this.fogAreas(d.sceneId), x, y, who.userId);
    return ok(this.emitTo({ type: "board.pinged", data: { id: this.newId(), userId: who.userId, userName: who.name, x, y, sceneId: d.sceneId, at: this.now() } }, { users }));
  }

  private objectMove(who: Actor, d: { id: string; x: number; y: number; rev: number }): Result {
    const obj = this.objects.get(d.id);
    if (!obj || !canSee(obj, who, this.activeSceneId)) return fail("not_found", "오브젝트를 찾을 수 없어요.");
    if (who.role === "spectator") return fail("forbidden", "관전자는 움직일 수 없어요.");
    if (who.role === "pl" && (obj.ownerId !== who.userId || obj.locked)) {
      return fail("forbidden", "내 토큰만 움직일 수 있어요.");
    }
    if (d.rev !== obj.rev) {
      // 오래된 화면에서 온 명령. 최신 상태를 요청자에게만 다시 알려 준다.
      const fix = this.emitTo({ type: "object.updated", data: { ...obj } }, { users: [who.userId] });
      return { ok: false, code: "stale", message: "다른 사람이 먼저 움직였어요.", out: [fix] };
    }
    const before = { ...obj };
    obj.x = d.x;
    obj.y = d.y;
    obj.rev += 1;
    return ok(...this.fanOutObject(before, obj));
  }

  private objectUpdate(
    who: Actor,
    d: Extract<ClientCommand, { type: "object.update" }>["data"],
  ): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 오브젝트를 바꿀 수 있어요.");
    const obj = this.objects.get(d.id);
    if (!obj) return fail("not_found", "오브젝트를 찾을 수 없어요.");
    if (d.ownerId) {
      if (this.members.get(d.ownerId)?.role !== "pl") return fail("bad_message", "소유자는 룸의 PL이어야 해요.");
    }
    const before = { ...obj };
    if (d.name !== undefined) obj.name = d.name;
    if (d.ownerId !== undefined) {
      if (d.ownerId) obj.ownerId = d.ownerId;
      else delete obj.ownerId;
    }
    if (d.image !== undefined) {
      if (d.image) obj.image = d.image;
      else delete obj.image;
    }
    if (d.layer !== undefined) obj.layer = d.layer;
    if (d.visibleTo !== undefined) obj.visibleTo = d.visibleTo;
    if (d.locked !== undefined) obj.locked = d.locked;
    if (d.vision !== undefined) {
      if (d.vision > 0) obj.vision = d.vision;
      else delete obj.vision;
    }
    obj.rev += 1;
    return ok(...this.fanOutObject(before, obj));
  }

  private objectRemove(who: Actor, id: string): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 오브젝트를 지울 수 있어요.");
    const obj = this.objects.get(id);
    if (!obj) return fail("not_found", "오브젝트를 찾을 수 없어요.");
    this.objects.delete(id);
    return ok(...this.fanOutObject(obj, null));
  }

  private undoMaps() {
    return { objects: this.objects, scenes: this.scenes };
  }

  /** GM의 가장 최근 변경을 되돌린다. 평소 명령과 같은 이벤트로 모든 화면을 맞춘다. */
  private undoLast(who: Actor): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 되돌릴 수 있어요.");
    const r = this.undoLog.undo(this.undoMaps(), this.members, MAX_OBJECTS);
    if (!r.ok) return fail("stale", r.message);
    const out: Out[] = [];
    if (r.obj) out.push(...this.fanOutObject(r.obj.before, r.obj.after));
    if (r.scene) out.push(...this.emitScene(r.scene));
    out.push(this.emitTo({ type: "undo.done", data: { label: r.label } }, { users: [who.userId] }));
    return ok(...out);
  }

  /**
   * 오브젝트가 바뀌었을 때 사용자마다 달라지는 이벤트를 만든다.
   * 계속 보임 → updated, 새로 보임 → added, 안 보이게 됨 → removed.
   */
  private fanOutObject(before: GameObject | null, after: GameObject | null): Out[] {
    const touched = before ?? after;
    if (touched) this.fanned.add(touched.id);
    const added: string[] = [];
    const updated: string[] = [];
    const removed: string[] = [];
    for (const m of this.members.values()) {
      const was = before ? canSee(before, m, this.activeSceneId) && this.passesFog(before, m, this.fogBefore) : false;
      const now = after ? canSee(after, m, this.activeSceneId) && this.passesFog(after, m, this.fogAreas()) : false;
      if (!was && now) added.push(m.userId);
      else if (was && now) updated.push(m.userId);
      else if (was && !now) removed.push(m.userId);
    }
    const out: Out[] = [];
    if (after && added.length) out.push(this.emit({ type: "object.added", data: { ...after } }, { users: added }));
    if (after && updated.length) out.push(this.emit({ type: "object.updated", data: { ...after } }, { users: updated }));
    const gone = before ?? after;
    if (gone && removed.length) out.push(this.emit({ type: "object.removed", data: { id: gone.id } }, { users: removed }));
    return out;
  }

  // ── 굴림 ───────────────────────────────────────────────

  /** GM이 판정을 요청한다. 상태는 만들지 않고 알리기만 한다. 굴림은 PL이 roll.request로 직접 한다. */
  private rollAsk(who: Actor, d: Extract<ClientCommand, { type: "roll.ask" }>["data"]): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 판정을 요청할 수 있어요.");
    if (d.targetUserId !== undefined && this.members.get(d.targetUserId)?.role !== "pl") {
      return fail("not_found", "그 참가자는 이 룸의 PL이 아니에요.");
    }
    const ask = { id: this.newId(), name: d.name.trim(), ...(d.difficulty ? { difficulty: d.difficulty } : {}), ...(d.targetUserId ? { targetUserId: d.targetUserId } : {}), at: this.now() };
    return ok(this.emit({ type: "roll.asked", data: ask }, { roles: ALL_ROLES }));
  }

  private rollRequest(who: Actor, d: Extract<ClientCommand, { type: "roll.request" }>["data"]): Result {
    if (who.role === "spectator") return fail("forbidden", "관전자는 굴릴 수 없어요.");
    if (d.secret && who.role !== "kp") return fail("forbidden", "비밀 굴림은 GM만 쓸 수 있어요.");
    if (this.tooMany(`roll:${who.userId}`, this.rollsPerSecond)) return fail("rate_limited", "너무 빨리 굴리고 있어요. 잠시 뒤에 다시 해 주세요.");

    let expr = d.expr ?? "";
    let label: string | undefined;
    let check: RollLogEntry["check"];
    if (d.skill) {
      const c = this.characters.get(d.skill.characterId);
      if (!c || !canSeeCharacter(c, who)) return fail("not_found", "캐릭터를 찾을 수 없어요.");
      const value = targetValue(c, d.skill.name);
      if (value === null) return fail("bad_roll", `'${d.skill.name}' 기능이 시트에 없어요.`);
      expr = skillExpr(value, d.skill.bonus, d.skill.difficulty);
      label = `${c.name} · ${d.skill.name}`;
      check = { characterId: c.id, name: d.skill.name, bonus: d.skill.bonus, ...(d.skill.difficulty ? { difficulty: d.skill.difficulty } : {}) };
    }

    const rolled = rollExpression(expr, this.rng);
    if (!rolled.ok) return fail("bad_roll", rolled.error);

    return this.logRoll(who, expr.trim(), label, rolled.outcome, d.secret, check ? { check } : {});
  }

  /** 굴림을 로그에 남기고 알린다. 비밀 굴림은 GM에게만 결과를 보낸다. */
  private logRoll(who: Actor, expr: string, label: string | undefined, outcome: RollLogEntry["outcome"], secret: boolean, meta: Partial<Pick<RollLogEntry, "check" | "pushOf" | "luckOf">>, ...extra: Out[]): Result {
    const entry: RollLogEntry = {
      id: this.newId(),
      userId: who.userId,
      userName: who.name,
      expr,
      ...(label ? { label } : {}),
      outcome,
      ...meta,
      session: this.sessionNumber,
      secret,
      at: this.now(),
    };
    this.rolls.push(entry);
    if (this.rolls.length > MAX_ROLL_LOG) this.rolls.shift();

    if (!secret) return ok(this.emit({ type: "roll.result", data: entry }, { roles: ALL_ROLES }), ...extra);
    return ok(
      this.emit({ type: "roll.result", data: entry }, { roles: ["kp"] }),
      this.emit(
        { type: "roll.hidden", data: { id: entry.id, userId: entry.userId, userName: entry.userName, at: entry.at } },
        { roles: ["pl", "spectator"] },
      ),
      ...extra,
    );
  }

  /** 무기 피해를 굴린다. 식 끝에 +db를 쓰면 시트의 피해 보너스를 따로 굴려 더한다. */
  private damageRoll(who: Actor, d: { characterId: string; weaponIndex: number }): Result {
    if (who.role === "spectator") return fail("forbidden", "관전자는 굴릴 수 없어요.");
    const c = this.characters.get(d.characterId);
    if (!c || !canSeeCharacter(c, who)) return fail("not_found", "캐릭터를 찾을 수 없어요.");
    const weapon = c.weapons?.[d.weaponIndex];
    if (!weapon) return fail("not_found", "무기를 찾을 수 없어요.");
    if (this.tooMany(`roll:${who.userId}`, this.rollsPerSecond)) return fail("rate_limited", "너무 빨리 굴리고 있어요. 잠시 뒤에 다시 해 주세요.");

    const text = weapon.damage.trim().toLowerCase();
    const withDb = text.endsWith("+db");
    const base = withDb ? text.slice(0, -3) : text;
    const rolls: number[] = [];
    let modifier = 0;
    const add = (expr: string): boolean => {
      if (/^[+-]?\d{1,3}$/.test(expr)) {
        modifier += Number(expr);
        return true;
      }
      const r = rollExpression(expr, this.rng);
      if (!r.ok || r.outcome.kind !== "dice") return false;
      rolls.push(...r.outcome.rolls);
      modifier += r.outcome.modifier;
      return true;
    };
    if (!add(base)) return fail("bad_roll", "무기의 피해 식이 올바르지 않아요.");
    if (withDb) {
      const db = deriveCharacter(c).damageBonus;
      if (db !== "0" && !add(db)) return fail("bad_roll", "피해 보너스를 굴리지 못했어요.");
    }
    const total = Math.max(0, rolls.reduce((a, b) => a + b, 0) + modifier);
    return this.logRoll(who, weapon.damage, `${c.name} · ${weapon.name} 피해`, { kind: "dice", expr: weapon.damage, rolls, modifier, total }, false, {});
  }

  /** 실패한 시트 판정을 같은 조건으로 한 번 더 굴린다. 한 굴림당 한 번이고, 푸시한 굴림은 다시 푸시할 수 없다. */
  private rollPush(who: Actor, rollId: string): Result {
    if (who.role === "spectator") return fail("forbidden", "관전자는 굴릴 수 없어요.");
    const orig = this.rolls.find((r) => r.id === rollId && !r.secret);
    if (!orig?.check) return fail("not_found", "푸시할 수 있는 굴림이 아니에요.");
    if (orig.userId !== who.userId && who.role !== "kp") return fail("forbidden", "자기 굴림만 푸시할 수 있어요.");
    if (orig.outcome.kind !== "cc" || orig.outcome.success !== false) return fail("bad_roll", "실패한 판정만 푸시할 수 있어요.");
    const c = this.characters.get(orig.check.characterId);
    if (!c || !canSeeCharacter(c, who)) return fail("not_found", "캐릭터를 찾을 수 없어요.");
    const blocked = pushBlockReason(this.ruleInput(orig, c));
    if (blocked) return fail("bad_roll", blocked);
    if (this.tooMany(`roll:${who.userId}`, this.rollsPerSecond)) return fail("rate_limited", "너무 빨리 굴리고 있어요. 잠시 뒤에 다시 해 주세요.");
    const value = targetValue(c, orig.check.name);
    if (value === null) return fail("bad_roll", `'${orig.check.name}' 기능이 시트에 없어요.`);
    const expr = skillExpr(value, orig.check.bonus, orig.check.difficulty);
    const rolled = rollExpression(expr, this.rng);
    if (!rolled.ok) return fail("bad_roll", rolled.error);
    return this.logRoll(who, expr, orig.label, rolled.outcome, false, { check: orig.check, pushOf: rollId });
  }

  /** 푸시·행운 규칙 검사에 넘길 입력. */
  private ruleInput(orig: RollLogEntry, c: Character): RollRuleInput {
    return {
      name: orig.check?.name ?? "",
      outcome: orig.outcome,
      isPush: Boolean(orig.pushOf),
      pushed: this.rolls.some((r) => r.pushOf === orig.id),
      luckUsed: this.rolls.some((r) => r.luckOf === orig.id),
      weaponSkills: (c.weapons ?? []).map((w) => w.skill),
    };
  }

  /** 실패한 시트 판정을 성공으로 바꿀 만큼의 행운을 쓴다. 한 굴림당 한 번이다. */
  private luckSpend(who: Actor, rollId: string): Result {
    if (who.role === "spectator") return fail("forbidden", "관전자는 행운을 쓸 수 없어요.");
    const orig = this.rolls.find((r) => r.id === rollId && !r.secret);
    if (!orig?.check || orig.outcome.kind !== "cc") return fail("not_found", "행운을 쓸 수 있는 굴림이 아니에요.");
    const c = this.characters.get(orig.check.characterId);
    if (!c || !canSeeCharacter(c, who)) return fail("not_found", "캐릭터를 찾을 수 없어요.");
    const blocked = luckBlockReason(this.ruleInput(orig, c));
    if (blocked) return fail("bad_roll", blocked);
    const need = luckNeeded(orig.outcome);
    if (need === null) return fail("bad_roll", "행운으로 성공으로 바꿀 수 없는 굴림이에요.");
    if (c.luck < need) return fail("bad_roll", `행운이 모자라요. 필요 ${need}, 보유 ${c.luck}.`);

    const next = cloneCharacter(c);
    next.luck = c.luck - need;
    next.rev = c.rev + 1;
    this.characters.set(c.id, next);
    const update = this.emit({ type: "character.updated", data: cloneCharacter(next) }, this.characterAudience(next));
    return this.logRoll(who, orig.expr, orig.label, applyLuck(orig.outcome, need), false, { check: orig.check, luckOf: rollId }, update);
  }

  // ── SAN과 광기 ─────────────────────────────────────────

  private sanCheck(who: Actor, d: { characterId: string; loss: string }): Result {
    if (who.role === "spectator") return fail("forbidden", "관전자는 굴릴 수 없어요.");
    const c = this.characters.get(d.characterId);
    if (!c || !canSeeCharacter(c, who)) return fail("not_found", "캐릭터를 찾을 수 없어요.");
    if (this.tooMany(`roll:${who.userId}`, this.rollsPerSecond)) return fail("rate_limited", "너무 빨리 굴리고 있어요. 잠시 뒤에 다시 해 주세요.");

    const day = c.sanDay ?? { start: c.san, lost: 0 };
    const r = resolveSanCheck({ rng: this.rng, expr: d.loss, san: c.san, int: c.characteristics.INT, day });
    if (!r.ok) return fail("bad_roll", r.error);
    const o = r.outcome;

    const next = cloneCharacter(c);
    next.san = o.after;
    next.sanDay = { start: day.start, lost: o.dailyLoss };
    // 광기는 무거운 쪽으로만 올라가고, 낮추는 것은 GM이 직접 한다.
    const rank = { none: 0, temporary: 1, indefinite: 2, permanent: 3 } as const;
    if (o.madness && rank[o.madness] > rank[c.madness ?? "none"]) next.madness = o.madness;
    next.rev = c.rev + 1;
    this.characters.set(c.id, next);
    const update = this.emit({ type: "character.updated", data: cloneCharacter(next) }, this.characterAudience(next));
    return this.logRoll(who, o.expr, `${c.name} · SAN 체크`, o, false, {}, update);
  }

  private setMadnessTable(who: Actor, entries: string[]): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 광기 증상표를 바꿀 수 있어요.");
    this.madnessTable = entries.slice(0, MAX_MADNESS_ENTRIES);
    return ok(this.emit({ type: "settings.madness", data: { entries: [...this.madnessTable] } }, { roles: ["kp"] }));
  }

  /** 증상표에서 하나 고르고 지속 시간(1d10)을 굴린다. 증상표 내용은 GM이 채운 것만 쓴다. */
  private madnessRoll(who: Actor, d: { characterId: string; mode: "realtime" | "summary" }): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 광기 증상을 굴릴 수 있어요.");
    const c = this.characters.get(d.characterId);
    if (!c) return fail("not_found", "캐릭터를 찾을 수 없어요.");
    if (this.madnessTable.length === 0) return fail("bad_message", "광기 증상표가 비어 있어요. 먼저 증상을 적어 주세요.");
    const index = rollDie(this.rng, this.madnessTable.length) - 1;
    const duration = rollDie(this.rng, 10);
    return ok(
      this.emit(
        { type: "madness.result", data: { characterId: c.id, name: c.name, mode: d.mode, duration, index, symptom: this.madnessTable[index] as string } },
        this.characterAudience(c),
      ),
    );
  }

  private sanNewDay(who: Actor, characterId?: string): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 하루가 지났다고 기록할 수 있어요.");
    const targets = characterId ? [this.characters.get(characterId)] : [...this.characters.values()];
    if (characterId && !targets[0]) return fail("not_found", "캐릭터를 찾을 수 없어요.");
    const outs: Out[] = [];
    for (const c of targets) {
      if (!c) continue;
      if (c.sanDay && c.sanDay.start === c.san && c.sanDay.lost === 0) continue;
      const next = cloneCharacter(c);
      next.sanDay = { start: c.san, lost: 0 };
      next.rev = c.rev + 1;
      this.characters.set(c.id, next);
      outs.push(this.emit({ type: "character.updated", data: cloneCharacter(next) }, this.characterAudience(next)));
    }
    return ok(...outs);
  }

  private tooMany(key: string, limit: number): boolean {
    const t = this.now();
    const recent = (this.rollTimes.get(key) ?? []).filter((x) => t - x < 1000);
    if (recent.length >= limit) {
      this.rollTimes.set(key, recent);
      return true;
    }
    recent.push(t);
    this.rollTimes.set(key, recent);
    return false;
  }

  // ── 핸드아웃 ───────────────────────────────────────────

  private handoutCreate(who: Actor, d: Extract<ClientCommand, { type: "handout.create" }>["data"]): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 핸드아웃을 만들 수 있어요.");
    if (this.handouts.size >= MAX_HANDOUTS) return fail("bad_message", `핸드아웃은 ${MAX_HANDOUTS}개까지 둘 수 있어요.`);
    const h: Handout = { id: this.newId(), title: d.title, body: d.body, visibleTo: d.kpOnly ? "gm" : d.visibleTo, rev: 0, ...(d.image ? { image: d.image } : {}), ...(d.kpOnly ? { kpOnly: true } : {}) };
    this.handouts.set(h.id, h);
    return ok(...this.fanOutHandout(null, h));
  }

  private handoutUpdate(who: Actor, d: Extract<ClientCommand, { type: "handout.update" }>["data"]): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 핸드아웃을 바꿀 수 있어요.");
    const h = this.handouts.get(d.id);
    if (!h) return fail("not_found", "핸드아웃을 찾을 수 없어요.");
    const before = cloneHandout(h);
    const locked = d.kpOnly ?? h.kpOnly ?? false;
    if (locked && d.visibleTo !== undefined && d.visibleTo !== "gm") return fail("bad_message", "GM 전용 노트는 공개할 수 없어요. 먼저 GM 전용을 풀어 주세요.");
    if (d.kpOnly !== undefined) {
      if (d.kpOnly) {
        h.kpOnly = true;
        h.visibleTo = "gm";
      } else delete h.kpOnly;
    }
    if (d.title !== undefined) h.title = d.title;
    if (d.body !== undefined) h.body = d.body;
    if (d.image !== undefined) {
      if (d.image) h.image = d.image;
      else delete h.image;
    }
    if (d.visibleTo !== undefined) h.visibleTo = d.visibleTo;
    h.rev += 1;
    return ok(...this.fanOutHandout(before, h));
  }

  private handoutRemove(who: Actor, id: string): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 핸드아웃을 지울 수 있어요.");
    const h = this.handouts.get(id);
    if (!h) return fail("not_found", "핸드아웃을 찾을 수 없어요.");
    this.handouts.delete(id);
    return ok(...this.fanOutHandout(h, null));
  }

  private handoutShow(who: Actor, id: string, reveal = false): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 핸드아웃을 펼쳐 보일 수 있어요.");
    const h = this.handouts.get(id);
    if (!h) return fail("not_found", "핸드아웃을 찾을 수 없어요.");
    if (h.kpOnly) return fail("bad_message", "GM 전용 노트는 펼쳐 보일 수 없어요.");
    const outs: Out[] = [];
    if (h.visibleTo === "gm") {
      if (!reveal) return fail("bad_message", "초안은 펼쳐 보일 수 없어요. 먼저 공개 범위를 정해 주세요.");
      // 공개하기: 초안을 전원 공개로 바꾸고 바로 펼쳐 보인다.
      const before = cloneHandout(h);
      h.visibleTo = "all";
      h.rev += 1;
      outs.push(...this.fanOutHandout(before, h));
    }
    // 한 번 쓰고 사라지는 연출이라 버퍼에는 남기지 않는다(늦게 들어온 사람에게 다시 띄우지 않는다).
    // 누른 GM 화면은 가리지 않는다.
    const users = [...this.members.values()].filter((m) => m.role !== "kp" && canSeeHandout(h, m)).map((m) => m.userId);
    outs.push(this.emitTo({ type: "handout.shown", data: { id } }, { users }));
    return ok(...outs);
  }

  /** 공개 범위가 바뀌면 새로 보이는 사람에겐 added, 계속 보이면 updated, 가려지면 removed를 보낸다. */
  private fanOutHandout(before: Handout | null, after: Handout | null): Out[] {
    const added: string[] = [];
    const updated: string[] = [];
    const removed: string[] = [];
    for (const m of this.members.values()) {
      const was = before ? canSeeHandout(before, m) : false;
      const now = after ? canSeeHandout(after, m) : false;
      if (!was && now) added.push(m.userId);
      else if (was && now) updated.push(m.userId);
      else if (was && !now) removed.push(m.userId);
    }
    const out: Out[] = [];
    if (after && added.length) out.push(this.emit({ type: "handout.added", data: cloneHandout(after) }, { users: added }));
    if (after && updated.length) out.push(this.emit({ type: "handout.updated", data: cloneHandout(after) }, { users: updated }));
    const gone = before ?? after;
    if (gone && removed.length) out.push(this.emit({ type: "handout.removed", data: { id: gone.id } }, { users: removed }));
    return out;
  }

  // ── 캐릭터 시트 ──────────────────────────────────────────

  private characterAdd(who: Actor, d: Extract<ClientCommand, { type: "character.add" }>["data"]): Result {
    if (who.role === "spectator") return fail("forbidden", "관전자는 캐릭터를 등록할 수 없어요.");
    if (d.ownerId && who.role !== "kp") return fail("forbidden", "다른 사람 몫의 캐릭터는 GM만 만들 수 있어요.");
    if (this.characters.size >= MAX_CHARACTERS) return fail("bad_sheet", `캐릭터는 ${MAX_CHARACTERS}명까지 둘 수 있어요.`);
    const ownerId = d.ownerId ?? who.userId;
    if (who.role === "pl") {
      // PL은 한 명만 등록할 수 있다. 바꾸고 싶으면 GM에게 부탁해 지운다.
      if ([...this.characters.values()].some((c) => c.ownerId === ownerId)) {
        return fail("bad_sheet", "이미 캐릭터를 등록했어요. 세션 시작 전에는 시트 아래 ‘이 캐릭터 빼기’로 바꿀 수 있어요.");
      }
    }
    if (d.skills.length > MAX_SKILLS) return fail("bad_sheet", `기능은 ${MAX_SKILLS}개까지 둘 수 있어요.`);
    const base = { characteristics: d.characteristics, age: d.age };
    const limits = deriveCharacter(base).limits;
    const skills: Character["skills"] = {};
    for (const s of d.skills) skills[s.name] = { value: s.value, grown: s.grown };
    const c: Character = {
      id: this.newId(),
      ...(d.vaultId ? { vaultId: d.vaultId } : {}),
      ownerId,
      name: d.name,
      age: d.age,
      occupation: d.occupation,
      characteristics: { ...d.characteristics },
      luck: d.luck ?? 0,
      hp: clamp(d.hp ?? limits.hp, 0, limits.hp),
      mp: clamp(d.mp ?? limits.mp, 0, limits.mp),
      san: clamp(d.san ?? d.characteristics.POW, 0, SAN_CAP),
      skills,
      notes: d.notes,
      backstory: d.backstory,
      possessions: d.possessions,
      weapons: (d.weapons ?? []).map((w) => ({ ...w })),
      rev: 0,
    };
    this.characters.set(c.id, c);
    return ok(this.emit({ type: "character.added", data: cloneCharacter(c) }, this.characterAudience(c)));
  }

  private characterRemove(who: Actor, id: string): Result {
    const c = this.characters.get(id);
    if (who.role !== "kp") {
      // PL은 자기 캐릭터를 첫 세션이 시작되기 전까지만 뺄 수 있다(잘못 불러온 캐릭터를 바꾸기 위해).
      if (!c || who.role !== "pl" || c.ownerId !== who.userId) return fail("forbidden", "GM만 다른 사람의 캐릭터를 지울 수 있어요.");
      if (this.status !== "IDLE" || this.sessionNumber > 0) return fail("forbidden", "세션이 시작된 뒤에는 GM만 캐릭터를 지울 수 있어요.");
    }
    if (!c) return fail("not_found", "캐릭터를 찾을 수 없어요.");
    this.characters.delete(id);
    return ok(this.emit({ type: "character.removed", data: { id } }, this.characterAudience(c)));
  }

  /** 주인과 GM에게만 보낸다. */
  private characterAudience(c: Character): Audience {
    return { roles: ["kp"], users: [c.ownerId] };
  }

  private sheetPatch(who: Actor, d: { characterId: string; ops: SheetOp[] }): Result {
    const c = this.characters.get(d.characterId);
    if (!c || !canSeeCharacter(c, who)) return fail("not_found", "캐릭터를 찾을 수 없어요.");
    if (who.role === "spectator") return fail("forbidden", "관전자는 시트를 바꿀 수 없어요.");
    if (this.tooMany(`sheet:${who.userId}`, SHEET_PATCHES_PER_SECOND)) {
      return fail("rate_limited", "시트를 너무 빨리 바꾸고 있어요. 잠시 뒤에 다시 해 주세요.");
    }

    // 복사본에 적용해 보고, 하나라도 실패하면 아무것도 바꾸지 않는다.
    const next = cloneCharacter(c);
    const limits = deriveCharacter(next).limits;
    for (const op of d.ops) {
      switch (op.path) {
        case "hp":
        case "mp":
        case "san":
        case "luck": {
          const cur = next[op.path];
          const target = op.value !== undefined ? op.value : cur + (op.delta ?? 0);
          next[op.path] = clamp(target, 0, limits[op.path]);
          break;
        }
        case "skill": {
          const cur = next.skills[op.name];
          if (!cur && op.value === undefined && op.delta === undefined) return fail("bad_sheet", `'${op.name}' 기능이 시트에 없어요.`);
          if (!cur && Object.keys(next.skills).length >= MAX_SKILLS) return fail("bad_sheet", `기능은 ${MAX_SKILLS}개까지 둘 수 있어요.`);
          const entry = cur ?? { value: 0, grown: false };
          if (op.value !== undefined) entry.value = clamp(op.value, 0, SKILL_CAP);
          else if (op.delta !== undefined) entry.value = clamp(entry.value + op.delta, 0, SKILL_CAP);
          if (op.grown !== undefined) entry.grown = op.grown;
          next.skills[op.name] = entry;
          break;
        }
        case "notes":
          next.notes = op.value;
          break;
        case "backstory":
        case "possessions":
          next[op.path] = op.value;
          break;
        case "weapons":
          next.weapons = op.value.map((w) => ({ ...w }));
          break;
        case "condition": {
          const set = new Set(next.conditions ?? []);
          if (op.on) set.add(op.name);
          else set.delete(op.name);
          if (set.size) next.conditions = [...set];
          else delete next.conditions;
          break;
        }
        case "madness":
          if (who.role !== "kp") return fail("forbidden", "광기 상태는 GM만 바꿀 수 있어요.");
          if (op.value === "none") delete next.madness;
          else next.madness = op.value;
          break;
      }
    }
    if (!d.ops.some((o) => o.path === "madness")) this.applyManualSanLoss(c, next);
    next.rev = c.rev + 1;
    this.characters.set(c.id, next);
    return ok(this.emit({ type: "character.updated", data: cloneCharacter(next) }, this.characterAudience(next)));
  }

  /**
   * 시트에서 SAN을 직접 바꿔도 오늘 손실과 광기 판정에 반영한다(GM이 "SAN 2 잃어요"라고 말한 경우).
   * 줄이면 오늘 손실이 늘고, 올리면 그만큼 줄어든다(잘못 누른 것을 바로잡는 경우). 0 아래로는 내려가지 않는다.
   * 하루 손실이 하루 시작 SAN의 1/5 이상이면 장기 광기, SAN 0이면 영구 광기로 올린다. INT 판정이 필요한
   * 일시적 광기는 굴림 없이 정할 수 없어서 자동으로 만들지 않는다.
   */
  private applyManualSanLoss(before: Character, next: Character): void {
    const delta = before.san - next.san;
    if (delta === 0) return;
    const day = before.sanDay ?? { start: before.san, lost: 0 };
    const lost = Math.max(0, day.lost + delta);
    if (delta < 0 && !before.sanDay) return; // 하루 기록이 없을 때 올린 것은 기록할 손실이 없다
    next.sanDay = { start: day.start, lost };
    if (delta < 0) return;
    const threshold = Math.floor(day.start / 5);
    const kind = next.san === 0 ? "permanent" : threshold > 0 && lost >= threshold ? "indefinite" : null;
    const rank = { none: 0, temporary: 1, indefinite: 2, permanent: 3 } as const;
    if (kind && rank[kind] > rank[next.madness ?? "none"]) next.madness = kind;
  }

  // ── 내부 ───────────────────────────────────────────────

  private memberList(): Member[] {
    return [...this.members.values()].map((m) => ({ ...m }));
  }

  private emit(event: Out["event"], audience: Audience): Out {
    const out: Out = { seq: ++this.seq, event, audience };
    this.buffer.push(out);
    if (this.buffer.length > this.bufferSize) this.buffer.shift();
    return out;
  }

  /** 버퍼에 남기지 않는 개별 안내(오래된 명령 교정 등). */
  private emitTo(event: Out["event"], audience: Audience): Out {
    return { seq: this.seq, event, audience };
  }
}

const cloneEffects = (e: EffectSettings): EffectSettings => ({
  critical: { ...e.critical },
  extreme: { ...e.extreme },
  hard: { ...e.hard },
  fumble: { ...e.fumble },
});

const DIFFICULTY_KO = { regular: "보통", hard: "어려움", extreme: "극단", critical: "대성공" } as const;

const cloneFlow = (f: Flow): Flow => ({
  ...f,
  beats: f.beats.map((b) => ({ ...b, handoutIds: [...b.handoutIds] })),
  branches: f.branches.map((b) => ({ ...b, condition: { ...b.condition } })),
  suggestions: f.suggestions.map((s) => ({ ...s })),
});

const sortByDex = (entries: InitiativeEntry[]): InitiativeEntry[] =>
  entries.map((e, i) => ({ e, i })).sort((a, b) => b.e.dex - a.e.dex || a.i - b.i).map((x) => x.e);

const cloneInitiative = (i: Initiative | null): Initiative | null => (i ? { ...i, entries: i.entries.map((e) => ({ ...e })) } : null);

const publicScene = (s: Scene): Scene => {
  const { start: _start, bgmTrackId: _bgm, fog: _fog, fogAreas: _areas, fogExplored: _explored, ...rest } = s;
  return rest;
};

const cloneHandout = (h: Handout): Handout => ({ ...h, visibleTo: Array.isArray(h.visibleTo) ? [...h.visibleTo] : h.visibleTo });

const cloneCharacter = (c: Character): Character => ({
  ...c,
  ...(c.weapons ? { weapons: c.weapons.map((w) => ({ ...w })) } : {}),
  ...(c.conditions ? { conditions: [...c.conditions] } : {}),
  ...(c.sanDay ? { sanDay: { ...c.sanDay } } : {}),
  characteristics: { ...c.characteristics },
  skills: Object.fromEntries(Object.entries(c.skills).map(([k, v]) => [k, { ...v }])),
});

/** 시트 판정의 CC 표기. */
const skillExpr = (value: number, bonus: number, difficulty?: "regular" | "hard" | "extreme") => {
  const suffix = difficulty === "hard" ? "h" : difficulty === "extreme" ? "e" : difficulty === "regular" ? "r" : "";
  return `CC${bonus !== 0 ? `(${bonus})` : ""}<=${value}${suffix}`;
};

const ok = (...out: Out[]): Result => ({ ok: true, out });
const fail = (code: ErrorCode, message: string): Result => ({ ok: false, code, message });
