import { PINGS_PER_SECOND, pingRecipients } from "./ping";
import {
  BGM_STOP,
  CHARACTERISTIC_KEYS,
  MAX_SKILLS,
  SAN_CAP,
  SKILL_CAP,
  defaultRng,
  applyDamage,
  applyHealing,
  applyManualHp,
  deriveCharacter,
  evaluateLevel,
  groupSummary,
  meetsDifficulty,
  opposedSummary,
  resolveOpposed,
  rollPercent,
  statusKeys,
  resolveSanCheck,
  rollDie,
  rollExpression,
  rollSumExpression,
  parseSumExpression,
  targetValue,
  type Character,
  type Condition,
  type DamageApplied,
  type GroupEntry,
  type OpposedSideOutcome,
  type SheetOp,
  type ClientCommand,
  type ErrorCode,
  DEFAULT_EFFECTS,
  DEFAULT_SCENE_ID,
  MAX_AUDIO_TRACKS,
  MAX_CHARACTERS,
  MAX_HANDOUTS,
  MAX_OBJECTS,
  MAX_SCENES,
  MAX_FOG_ZONES,
  type FogArea,
  MAX_FOG_EXPLORED,
  MAX_BEATS,
  MAX_BRANCHES,
  MAX_INITIATIVE_ENTRIES,
  MAX_MADNESS_ENTRIES,
  applyLuck,
  josa,
  isSafeKey,
  memberDisplayName,
  own,
  ownSafeEntries,
  UNSAFE_KEY_MESSAGE,
  applyMarker,
  STAT_PATHS,
  MAX_BANNED,
  type BannedUser,
  isMarkerKey,
  markerLabel,
  markersFor,
  sanitizeMarkers,
  MARKER_TEXT_MAX,
  BEAT_KIND_LABEL_KO,
  CHAT_KEEP,
  CHAT_HISTORY_ON_JOIN,
  CHAT_MAX_LENGTH,
  CHAT_PAGE_MAX,
  DEFAULT_CHAT_SETTINGS,
  LOG_KEEP,
  canSeeChat,
  describeOutcome,
  normalizeChatText,
  parseChatInput,
  queryLog,
  rollRow,
  type ChatMessage,
  type PartyStatus,
  type ChatSettings,
  type ChatTarget,
  type LogEntry,
  type LogKind,
  type LogPage,
  type LogQuery,
  type LogViewer,
  type RollRow,
  classifyRef,
  countScenario,
  defaultSkillValues,
  splitNoteTitle,
  type ScenarioCounts,
  type ScenarioDoc,
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
  type TokenVitals,
  type Visibility,
} from "@coc-vtt/shared";
import { UndoLog } from "./undo";
import { ROOM_SCHEMA_VERSION, migrateRoomData } from "./persist";

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
const SHEET_PATCHES_PER_SECOND = 10;
/** 한 사람이 1초에 보낼 수 있는 대화 수 */
export const CHATS_PER_SECOND = 3;
const DAMAGE_KIND_KO: Record<string, string> = { wounded: "부상", major: "중상", unconscious: "기절", dying: "빈사", dead: "사망" };

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
  /** 이미 적용한 피해(굴림 id → 캐릭터 id들). 이전 버전에서 저장한 데이터에는 없을 수 있다. */
  damageApplied?: Record<string, string[]>;
  /** 저장 모양 번호(persist.ts). 번호가 없으면 1(대화·세션 기록이 생기기 전)이다. */
  schemaVersion?: number;
  /** 대화(귓속말 포함, 최근 CHAT_KEEP개). 이전 버전에서 저장한 데이터에는 없을 수 있다. */
  chat?: ChatMessage[];
  chatSettings?: ChatSettings;
  /** 세션 기록(최근 LOG_KEEP개). 이전 버전에서 저장한 데이터에는 없을 수 있다. */
  log?: LogEntry[];
  /** 내보내며 막은 사용자(저장 모양 4). 이전 버전에서 저장한 데이터에는 없을 수 있다(없으면 빈 목록). */
  banned?: BannedUser[];
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
  "damage.apply",
  "hp.heal",
  "roll.opposed",
  "roll.group",
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

/** 시나리오 가져오기로 룸이 만든 것들. 되돌릴 때 이 목록을 보고 지운다. */
interface ImportRecord {
  id: string;
  sceneIds: string[];
  /** 비어 있던 기본 장면을 첫 장면으로 쓴 경우, 쓰기 전 모습 */
  reused?: { id: string; before: Scene };
  objectIds: string[];
  characterIds: string[];
  handoutIds: string[];
  trackIds: string[];
  beatIds: string[];
  branchIds: string[];
  madnessBefore?: string[];
}

export interface ImportOptions {
  /** 새로 만든 룸에 채우는 경우: 룸 설정(효과)도 적용하고, 소유자를 못 찾는 경고를 내지 않는다. */
  newRoom?: boolean;
  /** 서버 안에서 부를 때(by가 null) 시트·메모를 맡을 GM의 사용자 id */
  ownerId?: string;
  /** true면 검사만 하고 룸은 바꾸지 않는다. */
  dryRun?: boolean;
}

export interface ImportReport {
  importId: string;
  counts: ScenarioCounts;
  warnings: string[];
  /** 비어 있던 첫 장면에 첫 장면을 겹쳐 썼다 */
  reusedScene: boolean;
}

export type ImportResult = { ok: true; out: Out[]; report: ImportReport } | { ok: false; code: ErrorCode; message: string; errors: string[] };

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
  /** 굴림 id → 이미 피해를 적용한 캐릭터 id들(같은 피해를 두 번 적용하지 않게) */
  private damageApplied = new Map<string, Set<string>>();
  /** 시트에 이어진 토큰마다 마지막으로 알린 HP 요약. 바뀌면 보이는 사람에게 토큰 갱신을 보낸다(저장하지 않는다). */
  private vitalsSig = new Map<string, string>();
  /** 명령 직전의 PL 캐릭터 상태(변화를 알릴 때 비교한다) */
  private partyPrev: Map<string, PartyStatus> | null = null;
  private partySig = "";
  /** 방금 가져온 시나리오가 만든 것들(되돌리기용). 메모리에만 둔다. */
  private lastImport: ImportRecord | null = null;
  private chat: ChatMessage[] = [];
  private chatSettings: ChatSettings = { ...DEFAULT_CHAT_SETTINGS };
  private log: LogEntry[] = [];
  private logN = 0;
  /** 내보내며 막은 사용자. 같은 초대 링크로 다시 들어오지 못한다. */
  private banned = new Map<string, BannedUser>();

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
      damageApplied: Object.fromEntries([...this.damageApplied].map(([k, v]) => [k, [...v]])),
      schemaVersion: ROOM_SCHEMA_VERSION,
      chat: this.chat.map(cloneChat),
      chatSettings: { ...this.chatSettings },
      log: this.log.map(cloneLog),
      banned: [...this.banned.values()].map((b) => ({ ...b })),
    };
  }

  /**
   * 저장된 상태에서 룸을 되살린다. 서버가 내려갔다 올라온 경우 GM이 없으므로
   * 진행 중이던 세션은 자동 정지(kp_disconnected)로 두고, GM이 들어오면 자동 재개한다.
   * 저장 때 이미 정지였다면 사유를 그대로 따른다(옛 데이터는 GM이 누른 정지로 본다).
   */
  static fromData(stored: RoomData, opts: RoomOptions = {}): Room {
    const data = migrateRoomData(stored);
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
    for (const [k, v] of Object.entries(data.damageApplied ?? {})) room.damageApplied.set(k, new Set(v));
    room.chat = (data.chat ?? []).map(cloneChat);
    room.chatSettings = { ...DEFAULT_CHAT_SETTINGS, ...data.chatSettings };
    room.log = (data.log ?? []).map(cloneLog);
    room.logN = room.log.reduce((m, e) => Math.max(m, e.n), 0);
    for (const b of data.banned ?? []) room.banned.set(b.userId, { ...b });
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
    // 이름은 로그인 정보에서 온 글이라 한 번 더 정리한다(제어·방향 문자 제거, GM으로 착각할 이름에는 표시).
    const name = memberDisplayName(actor.name, actor.role === "kp");
    this.members.set(actor.userId, { userId: actor.userId, name, role: actor.role, online: true });
    const out: Out[] = [];
    if (!(prev && prev.online && prev.role === actor.role && prev.name === name)) {
      out.push(...this.presenceOuts());
    }
    if (actor.role === "kp") {
      if (this.kpAwaySince !== null) {
        this.kpAwaySince = null;
        out.push(this.emit({ type: "kp.back", data: {} }, { roles: ALL_ROLES }));
      }
      if (this.status === "PAUSED" && this.pauseReason === "kp_disconnected") {
        this.status = "ACTIVE";
        this.pauseReason = null;
        this.record("session", "resume", "GM이 돌아와서 세션을 이어가요.");
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
    const out: Out[] = this.presenceOuts();
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
    this.record("session", "pause", "일시정지 (GM 연결이 끊겼어요)");
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
      objects: [...this.objects.values()].filter((o) => this.visibleTo(o, viewer)).map((o) => this.view(o, viewer)),
      scenes: [...this.scenes.values()].filter((sc) => viewer.role === "kp" || sc.id === this.activeSceneId).map((sc) => this.sceneFor(sc, viewer.role === "kp")),
      activeSceneId: this.activeSceneId,
      effects: cloneEffects(this.effects),
      madnessTable: viewer.role === "kp" ? [...this.madnessTable] : [],
      initiative: this.initiativeFor(viewer),
      flow: viewer.role === "kp" ? cloneFlow(this.flow) : null,
      audioLibrary: viewer.role === "kp" ? this.audio.map((t) => ({ ...t })) : [],
      bgm: this.bgm ? { ...this.bgm } : null,
      now: this.now(),
      members: this.memberListFor(viewer),
      rolls: this.rolls.filter((r) => !r.secret || viewer.role === "kp").map((r) => ({ ...r })),
      characters: [...this.characters.values()].filter((c) => canSeeCharacter(c, viewer)).map(cloneCharacter),
      party: viewer.role === "spectator" ? [] : this.partyList(),
      handouts: [...this.handouts.values()].filter((h) => canSeeHandout(h, viewer)).map((h) => cloneHandout(h)),
      damageApplied: viewer.role === "kp" ? Object.fromEntries([...this.damageApplied].map(([k, v]) => [k, [...v]])) : {},
      chatSettings: { ...this.chatSettings },
      banned: viewer.role === "kp" ? [...this.banned.values()].map((b) => ({ ...b })) : [],
    };
  }

  /** 이 사용자가 이 룸에서 차단됐는가 */
  isBanned(userId: string): boolean {
    return this.banned.has(userId);
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
    this.primeVitals();
    if (this.partySig === "") this.partySig = JSON.stringify(this.partyList());
    this.partyPrev = this.partyMap();
    const pending = this.members.get(actor.userId)?.role === "kp" ? this.undoLog.capture(command, this.undoMaps()) : null;
    const first = this.dispatch(actor, command);
    if (first.ok && sceneBefore === this.activeSceneId) this.recordExplored();
    if (first.ok && pending) this.undoLog.commit(pending, this.undoMaps());
    // 안개 안의 오브젝트는 시야가 바뀌면 다른 오브젝트도 새로 보이거나 사라진다.
    let r = first.ok && sceneBefore === this.activeSceneId ? this.withFogDiff(first) : first;
    // 시트가 바뀌어 HP·상태가 달라졌으면 이어진 토큰을 새로 알린다.
    if (r.ok) {
      const vit = this.vitalsUpdates();
      const party = this.partyUpdates(actor);
      if (vit.length || party.length) r = ok(...r.out, ...vit, ...party);
    }
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
      // 대화는 세션 전·일시정지 중에도 할 수 있다(대화 안의 주사위만 진행 중에 굴린다).
      case "chat.send":
        return this.chatSend(who, command.data);
      case "chat.remove":
        return this.chatRemove(who, command.data.seq);
      case "roll.remove":
        return this.rollRemove(who, command.data.id);
      case "log.remove":
        return this.logRemove(who, command.data.n);
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
      case "settings.chat":
        return this.setChatSettings(who, command.data);
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
      case "scene.grid":
        return this.sceneGrid(who, command.data);
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
      case "scene.duplicate":
        return this.sceneDuplicate(who, command.data.id);
      case "scene.reorder":
        return this.sceneReorder(who, command.data);
      case "scenario.revert":
        return this.scenarioRevert(who, command.data.importId);
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
      case "object.marker":
        return this.objectMarker(who, command.data);
      case "member.remove":
        return this.memberRemove(who, command.data.userId, command.data.ban !== false);
      case "member.unban":
        return this.memberUnban(who, command.data.userId);
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
      case "damage.apply":
        return this.damageApply(who, command.data);
      case "hp.heal":
        return this.hpHeal(who, command.data);
      case "roll.opposed":
        return this.rollOpposed(who, command.data);
      case "roll.group":
        return this.rollGroup(who, command.data);
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
    this.record("session", "start", `세션 ${this.sessionNumber} 시작`);
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
    this.record("session", "pause", "일시정지 (GM이 멈췄어요)");
    return ok(this.emit({ type: "session.paused", data: { reason: "kp_request" } }, { roles: ALL_ROLES }));
  }

  private sessionResume(who: Actor): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 세션을 이어갈 수 있어요.");
    if (this.status !== "PAUSED") return fail("bad_message", "일시정지 중인 세션이 없어요.");
    this.status = "ACTIVE";
    this.pauseReason = null;
    this.record("session", "resume", "이어하기 (GM이 이어갔어요)");
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
    this.record("session", "end", `세션 ${this.sessionNumber} 종료${d.ending ? ` · 엔딩: ${d.ending}` : ""}`);
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
    this.record("beat", "goto", `비트 이동: ${beat.name} (${BEAT_KIND_LABEL_KO[beat.kind]})`, { audience: "gm" });
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
    const full = this.initiativeFor({ role: "kp", userId: "" });
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
    const copy = cloneInitiative(this.initiative)!;
    // 시트가 있는 칸에는 부상 상태(부상·중상·기절·빈사·사망)를 붙인다. 저장하지 않고 보낼 때마다 시트에서 읽는다.
    copy.entries = copy.entries.map((e) => {
      const c = e.characterId ? this.characters.get(e.characterId) : undefined;
      if (!c) return e;
      if (viewer.role !== "kp" && this.isNpcSheet(c)) return { id: e.id, name: "알 수 없는 상대", dex: 0, hidden: true };
      const status = statusKeys(c);
      return status.length ? { ...e, status } : e;
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
    this.record("combat", "start", `전투 시작 · ${entries.length}명`);
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
    let wrapped = false;
    if (init.turn >= init.entries.length) {
      init.turn = 0;
      init.round += 1;
      wrapped = true;
    }
    const ticks = wrapped ? this.tickDying() : [];
    const cur = init.entries[init.turn];
    if (cur) {
      // 참가자에게는 GM만 쓰는 시트(NPC)의 이름을 가려서 남긴다.
      const shown = this.initiativeFor({ role: "pl", userId: "" })?.entries[init.turn];
      this.record("combat", "turn", `라운드 ${init.round} · ${cur.name} 차례`, shown && shown.name !== cur.name ? { plText: `라운드 ${init.round} · ${shown.name} 차례` } : {});
    }
    const out = this.initiativeOut();
    return out.ok ? ok(...ticks, ...out.out) : out;
  }

  /** 라운드가 오를 때 빈사인 캐릭터의 라운드 세기를 올린다. 매 라운드 CON 판정은 GM이 이 세기를 보고 요청한다. */
  private tickDying(): Out[] {
    const outs: Out[] = [];
    for (const c of this.characters.values()) {
      if (!c.conditions?.includes("dying")) continue;
      const next = cloneCharacter(c);
      next.dyingRounds = (c.dyingRounds ?? 0) + 1;
      next.rev = c.rev + 1;
      this.characters.set(c.id, next);
      outs.push(this.emit({ type: "character.updated", data: cloneCharacter(next) }, this.characterAudience(next)));
    }
    return outs;
  }

  private initiativeEnd(who: Actor): Result {
    const denied = this.initiativeGuard(who);
    if (denied) return denied;
    if (!this.initiative) return fail("bad_message", "진행 중인 전투가 없어요.");
    this.record("combat", "end", `전투 종료 · ${this.initiative.round}라운드`);
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

  private sceneGrid(who: Actor, d: { id: string; size: number; show: boolean; snap: boolean }): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 격자를 바꿀 수 있어요.");
    const scene = this.scenes.get(d.id);
    if (!scene) return fail("not_found", "장면을 찾을 수 없어요.");
    scene.grid = { size: d.size, show: d.show, snap: d.snap };
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
        if (!was && now) added.push(this.view(o, m));
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
      // 이전 장면에서 서 있던 자리와 같은 자리에 두고(겹치면 가장 가까운 빈자리), 장면마다 토큰이 따로 남아 돌아오면 마지막 자리 그대로다.
      const spot = this.freeSpot(scene.id, src.x, src.y);
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
        ...(src.characterId && this.characters.has(src.characterId) ? { characterId: src.characterId } : {}),
      };
      this.objects.set(obj.id, obj);
      out.push(...this.fanOutObject(null, obj));
    }
    return out;
  }

  private activateScene(scene: Scene, transition: Transition, bringParty = true): Out[] {
    const out: Out[] = bringParty ? this.bringPartyTokens(scene) : [];
    this.activeSceneId = scene.id;
    this.record("scene", "activate", `장면 전환: ${scene.name}${transition === "fade" ? " (페이드)" : ""}`);
    for (const m of this.members.values()) {
      const data: Extract<Out["event"], { type: "scene.activated" }>["data"] = { scene: this.sceneFor(scene, m.role === "kp"), transition };
      if (m.role !== "kp") {
        data.objects = [...this.objects.values()].filter((o) => this.visibleTo(o, m)).map((o) => this.view(o, m));
      }
      out.push(this.emit({ type: "scene.activated", data }, { users: [m.userId] }));
    }
    // 장면에 묶은 배경음. 이미 같은 곡이 흐르고 있으면 끊지 않고 그대로 둔다.
    const track = scene.bgmTrackId ? this.audio.find((t) => t.id === scene.bgmTrackId && t.kind === "bgm") : undefined;
    if (track && this.bgm?.assetId !== track.assetId) out.push(this.startTrack(track, track.volume, transition === "fade" ? 1500 : 0));
    else if (scene.bgmTrackId === BGM_STOP) out.push(...this.stopBgm(transition === "fade" ? 1500 : 600));
    return out;
  }


  // ── 시트 연결 토큰 ──────────────────────────────────────

  /** 이어진 시트의 HP·상태 요약 */
  private vitalsOf(c: Character): TokenVitals {
    const status = statusKeys(c);
    return { hp: c.hp, max: deriveCharacter(c).limits.hp, ...(status.length ? { status } : {}) };
  }

  /**
   * 보는 사람에게 보낼 오브젝트 모양. 시트 연결은 GM과 시트 주인만 알고(NPC 시트 id는 PL에게 보내지 않는다),
   * HP 요약은 GM, PC 토큰(PL의 시트), GM이 HP를 공개한 토큰에서만 붙는다.
   */
  private view(o: GameObject, m: Pick<Member, "userId" | "role">): GameObject {
    const { vitals: _v, characterId, hpPublic, markers: allMarkers, ...rest } = o;
    // 비밀 표식은 GM에게만 간다.
    const shownMarkers = markersFor(allMarkers, m.role);
    const base: GameObject = { ...rest, ...(shownMarkers.length ? { markers: shownMarkers } : {}) };
    const c = characterId ? this.characters.get(characterId) : undefined;
    if (!characterId || !c) return base;
    if (m.role === "kp") return { ...base, characterId, ...(hpPublic ? { hpPublic } : {}), vitals: this.vitalsOf(c) };
    const mine = m.role === "pl" && c.ownerId === m.userId;
    const showHp = !this.isNpcSheet(c) || hpPublic === true;
    return { ...base, ...(mine ? { characterId } : {}), ...(showHp ? { vitals: this.vitalsOf(c) } : {}) };
  }

  private vitalsKey(o: GameObject, c: Character): string {
    return JSON.stringify([this.vitalsOf(c), o.hpPublic ?? false, this.isNpcSheet(c)]);
  }

  /** 명령을 처리하기 전의 HP 요약을 기억해 둔다(처음 보는 토큰만). */
  private primeVitals(): void {
    for (const o of this.objects.values()) {
      if (!o.characterId || this.vitalsSig.has(o.id)) continue;
      const c = this.characters.get(o.characterId);
      if (c) this.vitalsSig.set(o.id, this.vitalsKey(o, c));
    }
  }

  /** 명령 뒤에 HP 요약이 달라진 토큰을 보이는 사람에게 다시 알린다. */
  private vitalsUpdates(): Out[] {
    const out: Out[] = [];
    for (const o of this.objects.values()) {
      if (!o.characterId) {
        this.vitalsSig.delete(o.id);
        continue;
      }
      const c = this.characters.get(o.characterId);
      if (!c) continue;
      const sig = this.vitalsKey(o, c);
      const prev = this.vitalsSig.get(o.id);
      this.vitalsSig.set(o.id, sig);
      if (prev === undefined || prev === sig || this.fanned.has(o.id)) continue;
      out.push(...this.fanOutObject(o, o));
    }
    return out;
  }

  // ── 파티 상태 ───────────────────────────────────────────

  /** PL이 주인인 캐릭터들의 현재 상태(NPC는 넣지 않는다) */
  private partyList(): PartyStatus[] {
    const out: PartyStatus[] = [];
    for (const c of this.characters.values()) {
      if (this.members.get(c.ownerId)?.role !== "pl") continue;
      const lim = deriveCharacter(c).limits;
      out.push({ characterId: c.id, ownerId: c.ownerId, name: c.name, hp: c.hp, maxHp: lim.hp, mp: c.mp, maxMp: lim.mp, san: c.san, luck: c.luck });
    }
    return out;
  }

  private partyMap(): Map<string, PartyStatus> {
    return new Map(this.partyList().map((p) => [p.characterId, p]));
  }

  /** 명령 뒤에 파티 상태가 달라졌으면 목록을 다시 보내고, 바뀐 수치를 대화와 기록에 남긴다. */
  private partyUpdates(actor: Actor): Out[] {
    const list = this.partyList();
    const sig = JSON.stringify(list);
    const prev = this.partyPrev;
    this.partyPrev = null;
    if (sig === this.partySig) return [];
    this.partySig = sig;
    const out: Out[] = [];
    const aud: Audience = { roles: ["kp", "pl"] };
    if (prev) {
      for (const now of list) {
        const before = prev.get(now.characterId);
        if (!before) continue;
        const parts: string[] = [];
        const diff = (label: string, a: number, b: number) => {
          if (a !== b) parts.push(`${label} ${a} → ${b} (${b > a ? "+" : ""}${b - a})`);
        };
        diff("HP", before.hp, now.hp);
        diff("MP", before.mp, now.mp);
        diff("SAN", before.san, now.san);
        diff("행운", before.luck, now.luck);
        if (!parts.length) continue;
        const text = `${now.name}: ${parts.join(", ")}`;
        const seq = this.seq + 1;
        const m: ChatMessage = { id: `m${seq}`, seq, session: this.sessionNumber, at: this.now(), kind: "status", userId: actor.userId, name: actor.name, role: actor.role, text };
        out.push(this.emit({ type: "chat.posted", data: m }, aud));
        this.chat.push(cloneChat(m));
        if (this.chat.length > CHAT_KEEP) this.chat.splice(0, this.chat.length - CHAT_KEEP);
        this.record("status", "stat", text);
      }
    }
    out.push(this.emit({ type: "party.status", data: list.map((p) => ({ ...p })) }, aud));
    return out;
  }

  // ── 장면 복제·순서 ──────────────────────────────────────

  private freeSceneName(base: string): string {
    const taken = new Set([...this.scenes.values()].map((s) => s.name));
    const stem = base.slice(0, 33);
    let name = `${stem} 복사`;
    for (let i = 2; taken.has(name); i++) name = `${stem} 복사 ${i}`;
    return name;
  }

  private sceneDuplicate(who: Actor, id: string): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 장면을 복제할 수 있어요.");
    const src = this.scenes.get(id);
    if (!src) return fail("not_found", "장면을 찾을 수 없어요.");
    if (this.scenes.size >= MAX_SCENES) return fail("bad_message", `장면은 ${MAX_SCENES}개까지 둘 수 있어요.`);
    const objs = [...this.objects.values()].filter((o) => o.sceneId === id);
    if (this.objects.size + objs.length > MAX_OBJECTS) return fail("bad_message", `오브젝트는 ${MAX_OBJECTS}개까지 둘 수 있어서 복제할 수 없어요.`);
    const copy: Scene = {
      id: this.newId(),
      name: this.freeSceneName(src.name),
      ...(src.background ? { background: src.background } : {}),
      ...(src.bgmTrackId ? { bgmTrackId: src.bgmTrackId } : {}),
      ...(src.grid ? { grid: { ...src.grid } } : {}),
      ...(src.fog ? { fog: { enabled: src.fog.enabled, zones: src.fog.zones.map((z) => ({ ...z, id: this.newId() })) } } : {}),
    };
    // 원본 바로 뒤에 놓는다.
    const next = new Map<string, Scene>();
    for (const [k, v] of this.scenes) {
      next.set(k, v);
      if (k === id) next.set(copy.id, copy);
    }
    this.scenes = next;
    const out: Out[] = [
      this.emit({ type: "scene.added", data: this.sceneFor(copy, true) }, { roles: ["kp"] }),
      this.emit({ type: "scene.order", data: { ids: [...this.scenes.keys()] } }, { roles: ["kp"] }),
    ];
    for (const o of objs) {
      const dup: GameObject = { ...o, id: this.newId(), sceneId: copy.id, rev: 0 };
      this.objects.set(dup.id, dup);
      out.push(...this.fanOutObject(null, dup));
    }
    return ok(...out);
  }

  private sceneReorder(who: Actor, d: { id: string; index: number }): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 장면 순서를 바꿀 수 있어요.");
    const ids = [...this.scenes.keys()];
    const from = ids.indexOf(d.id);
    if (from < 0) return fail("not_found", "장면을 찾을 수 없어요.");
    const to = clamp(d.index, 0, ids.length - 1);
    if (to === from) return ok();
    ids.splice(from, 1);
    ids.splice(to, 0, d.id);
    this.scenes = new Map(ids.map((k) => [k, this.scenes.get(k)!]));
    return ok(this.emit({ type: "scene.order", data: { ids } }, { roles: ["kp"] }));
  }

  // ── 시나리오 가져오기 ───────────────────────────────────

  /** 첫 장면 자리에 쓸 수 있는, 아직 아무것도 꾸미지 않은 장면 */
  private blankScene(): Scene | undefined {
    if (this.scenes.size !== 1) return undefined;
    const sc = [...this.scenes.values()][0]!;
    const used = [...this.objects.values()].some((o) => o.sceneId === sc.id);
    return used || sc.background || sc.bgmTrackId || sc.fog || sc.start ? undefined : sc;
  }

  /**
   * 시나리오·백업 문서를 이 룸에 더한다. 검사를 모두 통과한 뒤에야 바꾸므로 전부 들어가거나 하나도 안 들어간다.
   * 파일 안의 key는 모두 새 id로 바뀌고, 이미지·음원은 호출한 쪽이 서버에 저장한 id로 바꿔서 넘긴다.
   * by가 null이면 서버가 새 룸을 채우는 경우다(opts.ownerId가 GM).
   */
  importScenario(by: string | null, doc: ScenarioDoc, opts: ImportOptions = {}): ImportResult {
    const bad = (message: string, errors: string[] = [message]): ImportResult => ({ ok: false, code: "bad_message", message, errors });
    let ownerId = opts.ownerId ?? "";
    if (by !== null) {
      const m = this.members.get(by);
      if (!m || m.role !== "kp") return { ok: false, code: "forbidden", message: "GM만 시나리오를 가져올 수 있어요.", errors: ["GM만 시나리오를 가져올 수 있어요."] };
      ownerId = by;
    }
    if (!ownerId) return bad("GM을 알 수 없어요.");

    const warnings: string[] = [];
    const errors: string[] = [];
    const warn = (m: string) => warnings.includes(m) || warnings.push(m);

    // 1) 한도
    const reuse = this.blankScene();
    const sceneTotal = this.scenes.size + doc.scenes.length - (reuse ? 1 : 0);
    const need: Array<[string, number, number, string]> = [
      ["장면", sceneTotal, MAX_SCENES, "개"],
      ["토큰·소품", this.objects.size + doc.tokens.length, MAX_OBJECTS, "개"],
      ["시트", this.characters.size + doc.characters.length, MAX_CHARACTERS, "개"],
      ["핸드아웃", this.handouts.size + doc.handouts.length, MAX_HANDOUTS, "개"],
      ["음원", this.audio.length + (doc.audio?.length ?? 0), MAX_AUDIO_TRACKS, "개"],
      ["비트", this.flow.beats.length + doc.beats.length, MAX_BEATS, "개"],
      ["분기", this.flow.branches.length + doc.branches.length, MAX_BRANCHES, "개"],
    ];
    for (const [label, total, max, unit] of need) {
      if (total > max) errors.push(`${label}가 합쳐서 ${total}${unit}가 돼서 한도(${max}${unit})를 넘어요. 룸에서 안 쓰는 것을 지우거나 파일을 줄여 주세요.`);
    }

    // 2) 사람 찾기: PC 시트 이름, PL 이름, PL1·PL2 순번 순서로 맞춰 본다.
    const pls = [...this.members.values()].filter((m) => m.role === "pl");
    const resolvePl = (label: string): string | null => {
      const t = label.trim();
      const sheet = [...this.characters.values()].find((c) => c.name === t && pls.some((p) => p.userId === c.ownerId));
      if (sheet) return sheet.ownerId;
      const named = pls.find((p) => p.name === t);
      if (named) return named.userId;
      const slot = /^PL\s*(\d{1,2})$/i.exec(t);
      return slot ? (pls[Number(slot[1]) - 1]?.userId ?? null) : null;
    };

    // 3) 이미지·음원 id
    const isId = (r: string | undefined): r is string => r !== undefined && classifyRef(r).kind === "id";
    let droppedImages = 0;
    const image = (r: string | undefined): string | undefined => {
      if (r === undefined) return undefined;
      if (isId(r)) return r;
      droppedImages += 1;
      return undefined;
    };

    // 4) 장면
    const startTaken = [...this.scenes.values()].some((s) => s.start);
    let startUsed = startTaken;
    const trackIdOf = new Map<string, string>();
    const newTracks: AudioTrack[] = [];
    for (const a of doc.audio ?? []) {
      if (!a.assetId) {
        warn(`음원 '${a.label}'은 파일이 없어서 건너뛰었어요.`);
        continue;
      }
      const t: AudioTrack = { id: this.newId(), label: a.label, kind: a.kind, assetId: a.assetId, volume: a.volume ?? 80 };
      newTracks.push(t);
      trackIdOf.set(a.key, t.id);
    }
    const bgmOf = (key: string | undefined, where: string): string | undefined => {
      if (key === undefined) return undefined;
      if (key === BGM_STOP) return BGM_STOP;
      const id = trackIdOf.get(key);
      if (!id) warn(`${where}의 배경음 '${key}'를 쓸 수 없어서 비워 뒀어요.`);
      return id;
    };

    const sceneIdOf = new Map<string, string>();
    const newScenes: Scene[] = [];
    doc.scenes.forEach((s, i) => {
      const useReuse = reuse && i === 0;
      const id = useReuse ? reuse.id : this.newId();
      const bg = image(s.background);
      const bgm = bgmOf(s.bgm, `장면 '${s.name}'`);
      const sc: Scene = {
        id,
        name: s.name,
        ...(bg ? { background: bg } : {}),
        ...(bgm ? { bgmTrackId: bgm } : {}),
        ...(s.fog ? { fog: { enabled: s.fog.enabled, zones: s.fog.zones.map((z) => ({ id: this.newId(), x: z.x, y: z.y, r: z.r })) } } : {}),
      };
      if (s.start) {
        if (startUsed) warn(`장면 '${s.name}'은 시작 장면으로 정하지 않았어요. 이미 시작 장면이 있어요.`);
        else {
          sc.start = true;
          startUsed = true;
        }
      }
      sceneIdOf.set(s.key, id);
      newScenes.push(sc);
    });

    // 5) 시트(GM 몫의 NPC 시트로 들어온다)
    const charIdOf = new Map<string, string>();
    const newChars: Character[] = [];
    let pcCount = 0;
    for (const c of doc.characters) {
      const limits = deriveCharacter({ characteristics: c.characteristics, age: c.age }).limits;
      const values = new Map(defaultSkillValues({ characteristics: c.characteristics }).map((s) => [s.name, { value: s.value, grown: false }]));
      for (const sk of c.skills) values.set(sk.name, { value: sk.value, grown: sk.grown ?? false });
      if (values.size > MAX_SKILLS) {
        errors.push(`시트 '${c.name}'의 기능이 ${MAX_SKILLS}개를 넘어요.`);
        continue;
      }
      const ch: Character = {
        id: this.newId(),
        ownerId,
        name: c.name,
        age: c.age,
        occupation: c.occupation,
        characteristics: { ...c.characteristics },
        luck: c.luck ?? 0,
        hp: clamp(c.hp ?? limits.hp, 0, limits.hp),
        mp: clamp(c.mp ?? limits.mp, 0, limits.mp),
        san: clamp(c.san ?? c.characteristics.POW, 0, SAN_CAP),
        skills: Object.fromEntries([...values].filter(([k]) => isSafeKey(k))),
        notes: c.notes,
        backstory: c.backstory,
        possessions: c.possessions,
        weapons: c.weapons.map((w) => ({ ...w })),
        rev: 0,
      };
      if (c.pc) pcCount += 1;
      newChars.push(ch);
      if (c.key) charIdOf.set(c.key, ch.id);
    }
    if (pcCount > 0) warn(`PL의 캐릭터였던 시트 ${pcCount}개는 GM 몫으로 들어와요. PL은 보관함에서 직접 불러올 수 있어요.`);

    // 6) 핸드아웃
    const handoutIdOf = new Map<string, string>();
    const newHandouts: Handout[] = [];
    for (const h of doc.handouts) {
      const note = splitNoteTitle(h.title);
      const kpOnly = h.kpOnly === true || note.kpOnly;
      let visibleTo: Visibility = h.visibleTo;
      if (kpOnly) visibleTo = "gm";
      else if (h.to) {
        const ids: string[] = [];
        for (const label of h.to) {
          const uid = resolvePl(label);
          if (uid) ids.push(uid);
          else if (!opts.newRoom) warn(`핸드아웃 '${note.title}'의 공개 대상 ${josa(`'${label}'`, "을/를")} 찾지 못했어요.`);
        }
        visibleTo = ids.length ? [...new Set(ids)] : "gm";
        if (!ids.length && !opts.newRoom) warn(`핸드아웃 '${note.title}'은 공개 대상을 찾지 못해 GM 전용으로 뒀어요.`);
      }
      const img = image(h.image);
      const ho: Handout = { id: this.newId(), title: note.title, body: h.body, visibleTo, rev: 0, ...(img ? { image: img } : {}), ...(kpOnly ? { kpOnly: true } : {}) };
      newHandouts.push(ho);
      handoutIdOf.set(h.key, ho.id);
    }

    // 7) 토큰·소품
    const newObjects: GameObject[] = [];
    const lostOwners = new Map<string, number>();
    for (const t of doc.tokens) {
      const sceneId = sceneIdOf.get(t.scene);
      if (!sceneId) continue;
      let owner: string | undefined;
      if (t.owner && t.kind === "token") {
        owner = resolvePl(t.owner) ?? undefined;
        if (!owner) lostOwners.set(t.owner, (lostOwners.get(t.owner) ?? 0) + 1);
      }
      const img = image(t.image);
      const charId = t.character ? charIdOf.get(t.character) : undefined;
      newObjects.push({
        id: this.newId(),
        sceneId,
        kind: t.kind,
        name: t.name,
        x: t.x,
        y: t.y,
        layer: t.layer,
        visibleTo: t.visibleTo,
        locked: t.locked === true,
        rev: 0,
        ...(owner ? { ownerId: owner } : {}),
        ...(img ? { image: img } : {}),
        ...(t.vision ? { vision: t.vision } : {}),
        ...(charId ? { characterId: charId } : {}),
        ...(charId && t.hpPublic ? { hpPublic: true } : {}),
        ...(t.kind === "token" && sanitizeMarkers(t.markers).length ? { markers: sanitizeMarkers(t.markers) } : {}),
      });
    }
    if (!opts.newRoom) for (const [label, n] of lostOwners) warn(`토큰 ${n}개의 소유자 ${josa(`'${label}'`, "을/를")} 찾지 못해 소유자 없음(NPC)으로 놓았어요.`);
    if (droppedImages > 0) warn(`이미지 ${droppedImages}개를 쓸 수 없어서(올려 둔 파일이 아니에요) 건너뛰었어요.`);

    // 8) 흐름
    const beatIdOf = new Map<string, string>();
    const newBeats: Beat[] = [];
    let hasStart = this.flow.beats.some((b) => b.kind === "start");
    for (const b of doc.beats) {
      if (b.sanReward) {
        const probe = parseSumExpression(b.sanReward);
        if (!probe.ok) {
          errors.push(`비트 '${b.name}'의 SAN 보상 식을 알아볼 수 없어요: ${probe.error}`);
          continue;
        }
      }
      let kind = b.kind;
      if (kind === "start") {
        if (hasStart) {
          kind = "progress";
          warn(`비트 '${b.name}'은 시작 비트가 이미 있어서 진행 비트로 넣었어요.`);
        }
        hasStart = true;
      }
      const bgm = bgmOf(b.bgm, `비트 '${b.name}'`);
      const beat: Beat = {
        id: this.newId(),
        name: b.name,
        kind,
        memo: b.memo,
        handoutIds: [...new Set(b.handouts.flatMap((k) => (handoutIdOf.has(k) ? [handoutIdOf.get(k)!] : [])))],
        ...(b.scene && sceneIdOf.has(b.scene) ? { sceneId: sceneIdOf.get(b.scene)! } : {}),
        ...(bgm ? { bgmTrackId: bgm } : {}),
        ...(b.sanReward && kind === "ending" ? { sanReward: b.sanReward } : {}),
      };
      newBeats.push(beat);
      beatIdOf.set(b.key, beat.id);
    }
    const newBranches: Branch[] = [];
    for (const br of doc.branches) {
      const from = beatIdOf.get(br.from);
      const to = beatIdOf.get(br.to);
      if (!from || !to) continue;
      let condition: Branch["condition"] = { type: "manual" };
      const c = br.condition;
      if (c?.type === "handout") {
        const hid = handoutIdOf.get(c.handout);
        if (hid) condition = { type: "handout", handoutId: hid };
        else warn(`분기 '${br.label}'의 핸드아웃 조건을 찾지 못해 직접 고르는 분기로 넣었어요.`);
      } else if (c) condition = c;
      newBranches.push({ id: this.newId(), from, to, label: br.label, condition });
    }

    // 9) 광기표·효과
    let madness: string[] | undefined;
    if (doc.madnessTable && doc.madnessTable.length > 0) {
      if (this.madnessTable.length === 0) madness = doc.madnessTable.map((e) => e.trim()).slice(0, MAX_MADNESS_ENTRIES);
      else warn("광기 증상표는 이미 있어서 그대로 뒀어요.");
    }
    if (doc.effects && !opts.newRoom) warn("판정 효과 설정은 새 룸에서만 적용해요.");

    const counts = countScenario(doc);
    if (errors.length) return bad(errors[0]!, errors);
    const importId = this.newId();
    const report: ImportReport = { importId, counts, warnings, reusedScene: Boolean(reuse) };
    if (opts.dryRun) return { ok: true, out: [], report };

    // ── 여기부터 룸을 바꾼다. 위에서 모두 확인했으므로 중간에 멈추지 않는다. ──
    this.primeVitals();
    this.fogBefore = this.fogAreas();
    this.fanned = new Set();
    this.exploredChanged = false;
    const rec: ImportRecord = {
      id: importId,
      sceneIds: newScenes.filter((s) => s.id !== reuse?.id).map((s) => s.id),
      objectIds: newObjects.map((o) => o.id),
      characterIds: newChars.map((c) => c.id),
      handoutIds: newHandouts.map((h) => h.id),
      trackIds: newTracks.map((t) => t.id),
      beatIds: newBeats.map((b) => b.id),
      branchIds: newBranches.map((b) => b.id),
      ...(reuse ? { reused: { id: reuse.id, before: { ...reuse } } } : {}),
    };
    const out: Out[] = [];
    if (newTracks.length) {
      this.audio.push(...newTracks);
      out.push(this.libraryOut());
    }
    if (madness) {
      rec.madnessBefore = [...this.madnessTable];
      this.madnessTable = madness;
      out.push(this.emit({ type: "settings.madness", data: { entries: [...this.madnessTable] } }, { roles: ["kp"] }));
    }
    if (opts.newRoom && doc.effects) {
      this.effects = cloneEffects({ ...DEFAULT_EFFECTS, ...doc.effects });
      out.push(this.emit({ type: "settings.effects", data: { effects: cloneEffects(this.effects) } }, { roles: ALL_ROLES }));
    }
    for (const sc of newScenes) {
      const had = this.scenes.has(sc.id);
      this.scenes.set(sc.id, sc);
      if (had) out.push(...this.emitScene(sc));
      else out.push(this.emit({ type: "scene.added", data: this.sceneFor(sc, true) }, { roles: ["kp"] }));
    }
    for (const c of newChars) {
      this.characters.set(c.id, c);
      out.push(this.emit({ type: "character.added", data: cloneCharacter(c) }, this.characterAudience(c)));
    }
    for (const h of newHandouts) {
      this.handouts.set(h.id, h);
      out.push(...this.fanOutHandout(null, h));
    }
    for (const o of newObjects) {
      this.objects.set(o.id, o);
      out.push(...this.fanOutObject(null, o));
    }
    if (newBeats.length || newBranches.length) {
      this.flow.beats.push(...newBeats);
      this.flow.branches.push(...newBranches);
      out.push(this.flowOut());
    }
    this.lastImport = rec;
    const res = this.withFogDiff({ ok: true, out });
    return res.ok ? { ok: true, out: res.out, report } : bad(res.message);
  }

  /** 방금 가져온 시나리오가 만든 것을 모두 지운다. 가져온 뒤에 바꾼 내용도 함께 사라진다. */
  private scenarioRevert(who: Actor, importId: string): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 가져오기를 되돌릴 수 있어요.");
    const rec = this.lastImport;
    if (!rec || rec.id !== importId) return fail("not_found", "되돌릴 가져오기를 찾지 못했어요. 이미 되돌렸거나, 그 뒤에 다른 시나리오를 가져왔을 수 있어요.");
    if (rec.sceneIds.includes(this.activeSceneId)) return fail("bad_message", "가져온 장면이 진행 중이라 되돌릴 수 없어요. 다른 장면으로 바꾼 뒤에 해 주세요.");
    const out: Out[] = [];
    const take = (r: Result) => {
      if (r.ok) out.push(...r.out);
    };
    // 비트·분기 → 가져온 장면(안의 오브젝트와 함께) → 첫 장면에 놓였던 오브젝트 → 시트 → 핸드아웃 → 음원 → 광기표 순서로 지운다.
    const beats = new Set(rec.beatIds);
    const branches = new Set(rec.branchIds);
    if (beats.size || branches.size) {
      this.flow.beats = this.flow.beats.filter((b) => !beats.has(b.id));
      this.flow.branches = this.flow.branches.filter((b) => !branches.has(b.id) && !beats.has(b.from) && !beats.has(b.to));
      if (this.flow.current && beats.has(this.flow.current)) this.flow.current = null;
      this.pruneSuggestions();
      out.push(this.flowOut());
    }
    const inScenes = new Set(rec.sceneIds);
    for (const id of rec.objectIds) {
      const o = this.objects.get(id);
      if (o && !inScenes.has(o.sceneId)) take(this.objectRemove(who, id));
    }
    for (const id of rec.sceneIds) if (this.scenes.has(id)) take(this.sceneRemove(who, id));
    if (rec.reused && this.scenes.has(rec.reused.id)) {
      this.scenes.set(rec.reused.id, { ...rec.reused.before });
      out.push(...this.emitScene(this.scenes.get(rec.reused.id)!));
    }
    for (const id of rec.characterIds) if (this.characters.has(id)) take(this.characterRemove(who, id));
    for (const id of rec.handoutIds) if (this.handouts.has(id)) take(this.handoutRemove(who, id));
    for (const id of rec.trackIds) if (this.audio.some((t) => t.id === id)) take(this.audioTrackRemove(who, id));
    if (rec.madnessBefore) {
      this.madnessTable = [...rec.madnessBefore];
      out.push(this.emit({ type: "settings.madness", data: { entries: [...this.madnessTable] } }, { roles: ["kp"] }));
    }
    this.lastImport = null;
    out.push(this.emitTo({ type: "undo.done", data: { label: "시나리오 가져오기" } }, { users: [who.userId] }));
    return ok(...out);
  }

  // ── 오브젝트 ────────────────────────────────────────────

  private objectAdd(who: Actor, d: Extract<ClientCommand, { type: "object.add" }>["data"]): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 오브젝트를 추가할 수 있어요.");
    if (this.objects.size >= MAX_OBJECTS) return fail("bad_message", `오브젝트는 ${MAX_OBJECTS}개까지 둘 수 있어요.`);
    const sceneId = d.sceneId ?? this.activeSceneId;
    if (!this.scenes.has(sceneId)) return fail("not_found", "장면을 찾을 수 없어요.");
    if (d.ownerId && this.members.get(d.ownerId)?.role !== "pl") return fail("bad_message", "소유자는 룸의 PL이어야 해요.");
    if (d.characterId && !this.characters.has(d.characterId)) return fail("not_found", "캐릭터 시트를 찾을 수 없어요.");
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
      ...(d.characterId ? { characterId: d.characterId } : {}),
      ...(d.hpPublic ? { hpPublic: true } : {}),
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
      const fix = this.emitTo({ type: "object.updated", data: this.view(obj, who) }, { users: [who.userId] });
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
    if (d.characterId && !this.characters.has(d.characterId)) return fail("not_found", "캐릭터 시트를 찾을 수 없어요.");
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
    if (d.characterId !== undefined) {
      if (d.characterId) obj.characterId = d.characterId;
      else delete obj.characterId;
    }
    if (d.hpPublic !== undefined) {
      if (d.hpPublic) obj.hpPublic = true;
      else delete obj.hpPublic;
    }
    obj.rev += 1;
    return ok(...this.fanOutObject(before, obj));
  }

  /**
   * 토큰의 상태 표식 하나를 켜거나 끈다. GM은 모든 토큰·모든 표식(비밀 포함),
   * 토큰의 주인 PL은 자기 토큰의 비밀이 아닌 표식만 바꾼다. 관전자는 바꿀 수 없다.
   * GM이 몰래 붙인 같은 표식이 있으면 PL의 요청은 아무것도 바꾸지 않고 조용히 넘어간다(비밀 표식이 있다는 사실이 새지 않게).
   */
  private objectMarker(who: Actor, d: Extract<ClientCommand, { type: "object.marker" }>["data"]): Result {
    const kpView = { userId: "", role: "kp" } as const;
    if (who.role === "spectator") return fail("forbidden", "관전자는 표식을 바꿀 수 없어요.");
    const obj = this.objects.get(d.id);
    if (!obj || !canSee(obj, who, this.activeSceneId)) return fail("not_found", "토큰을 찾을 수 없어요.");
    if (obj.kind !== "token") return fail("bad_message", "표식은 토큰에만 붙일 수 있어요.");
    if (who.role === "pl") {
      if (obj.ownerId !== who.userId) return fail("forbidden", "내 토큰에만 표식을 붙일 수 있어요.");
      if (d.secret) return fail("forbidden", "비밀 표식은 GM만 쓸 수 있어요.");
    }
    if (d.on && d.key === "custom" && !d.text?.trim()) return fail("bad_message", `사용자 지정 표식에는 짧은 글(${MARKER_TEXT_MAX}자까지)이 필요해요.`);
    if (d.text !== undefined && d.text.trim().length > MARKER_TEXT_MAX) return fail("bad_message", `표식 글은 ${MARKER_TEXT_MAX}자까지 적을 수 있어요.`);
    const cur = obj.markers ?? [];
    const existing = cur.find((m) => m.key === d.key);
    if (who.role === "pl" && existing?.secret) return ok();
    const next = applyMarker(cur, d.key, d.on, { ...(d.secret ? { secret: true } : {}), ...(d.text ? { text: d.text } : {}) });
    if (!next) return ok();
    const before = { ...obj };
    if (next.length > 0) obj.markers = next;
    else delete obj.markers;
    // 모두에게 보이는 표식이 달라졌을 때만 rev를 올려 알린다. 비밀 표식만 바뀌었으면 GM에게만 알리고 rev는 그대로 둔다
    // (PL이 rev나 이벤트로 GM의 비밀 표식 작업을 눈치채지 못하게).
    const publicChanged = JSON.stringify(markersFor(before.markers, "pl")) !== JSON.stringify(markersFor(obj.markers, "pl"));
    if (publicChanged) obj.rev += 1;
    const label = markerLabel(d.key === "custom" ? { key: "custom", text: d.text ?? existing?.text ?? "" } : { key: d.key });
    const hiddenMarker = d.secret === true || (!d.on && existing?.secret === true);
    this.record("combat", "marker", `${obj.name}: 표식 '${label}'${hiddenMarker ? "(GM만 보임)" : ""} ${d.on ? "켬" : "끔"}`, hiddenMarker ? { audience: "gm" } : {});
    if (publicChanged) return ok(...this.fanOutObject(before, obj));
    this.fanned.add(obj.id);
    return ok(this.emit({ type: "object.updated", data: this.view(obj, kpView) }, { roles: ["kp"] }));
  }

  /**
   * GM이 참가자(PL·관전자)를 내보낸다. 받은 사람은 알림을 받고 연결이 닫힌다(허브가 닫는다).
   * ban이 true(기본)면 차단 목록에도 올라 같은 초대 링크로 다시 들어오지 못하고, 풀어 줄 때까지 막힌다.
   * ban이 false면 목록에서만 빠진다(초대 링크가 유효하면 다시 들어올 수 있다). 자기 자신과 GM은 내보낼 수 없다.
   * 내보낸 PL의 시트는 룸에 그대로 남고(GM이 정리한다), 차단을 풀고 다시 들어오면 주인으로 이어진다.
   */
  private memberRemove(who: Actor, userId: string, ban: boolean): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 참가자를 내보낼 수 있어요.");
    if (userId === who.userId) return fail("forbidden", "자기 자신은 내보낼 수 없어요.");
    const m = this.members.get(userId);
    if (!m) return fail("not_found", "그 참가자를 찾을 수 없어요.");
    if (m.role === "kp") return fail("forbidden", "GM은 내보낼 수 없어요.");
    if (ban && !this.banned.has(userId) && this.banned.size >= MAX_BANNED) return fail("bad_message", `차단은 ${MAX_BANNED}명까지 둘 수 있어요. 차단 목록을 정리해 주세요.`);
    this.members.delete(userId);
    this.rollTimes.delete(`chat:${userId}`);
    this.rollTimes.delete(`sheet:${userId}`);
    const who2 = m.role === "pl" ? "PL" : "관전자";
    this.record("session", "member.remove", `${who2} ${m.name} 내보냄${ban ? " (차단)" : ""}`, { audience: "gm" });
    const out: Out[] = [this.emitTo({ type: "member.removed", data: ban ? { banned: true } : {} }, { users: [userId] })];
    if (ban) {
      this.banned.set(userId, { userId, name: m.name, at: this.now() });
      out.push(this.emitBans());
    }
    return ok(...out, ...this.presenceOuts());
  }

  /** GM이 차단을 푼다. 풀린 사람은 유효한 초대 링크로 다시 들어올 수 있다. */
  private memberUnban(who: Actor, userId: string): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 차단을 풀 수 있어요.");
    const b = this.banned.get(userId);
    if (!b) return fail("not_found", "차단 목록에 없는 사람이에요.");
    this.banned.delete(userId);
    this.record("session", "member.unban", `${b.name} 차단을 풀었어요`, { audience: "gm" });
    return ok(this.emitBans());
  }

  private emitBans(): Out {
    return this.emit({ type: "bans.updated", data: { banned: [...this.banned.values()].map((x) => ({ ...x })) } }, { roles: ["kp"] });
  }

  /**
   * 대화(귓속말 포함)나 세션 기록을 비운다. 룸 주인이 REST로 요청하며, 권한 확인은 부르는 쪽이 한다.
   * 다시 접속하는 사람이 지난 이벤트로 지운 대화를 되받지 못하게 이벤트 버퍼에서도 대화를 걷어낸다.
   * 기록을 비우면 "비웠다"는 한 줄만 새로 남는다(누가 비웠는지 GM이 알 수 있게).
   */
  purgeHistory(scope: { chat: boolean; log: boolean }): Out[] {
    if (scope.chat) {
      this.chat = [];
      this.buffer = this.buffer.filter((o) => o.event.type !== "chat.posted" && o.event.type !== "chat.history");
    }
    if (scope.log) this.log = [];
    const out: Out[] = [this.emit({ type: "history.purged", data: { chat: scope.chat, log: scope.log } }, { roles: ALL_ROLES })];
    if (scope.log) this.record("session", "history.purge", scope.chat ? "대화와 세션 기록을 비웠어요" : "세션 기록을 비웠어요", { audience: "gm" });
    return out;
  }

  private chatRemove(who: Actor, seq: number): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 대화를 지울 수 있어요.");
    const i = this.chat.findIndex((m) => m.seq === seq);
    if (i < 0) return fail("not_found", "이미 지워졌거나 없는 대화예요.");
    this.chat.splice(i, 1);
    // 다시 접속하는 사람이 지운 대화를 되받지 않게 이벤트 버퍼에서도 걷어낸다.
    this.buffer = this.buffer.filter((o) => !(o.event.type === "chat.posted" && o.event.data.seq === seq));
    return ok(this.emit({ type: "chat.removed", data: { seq } }, { roles: ALL_ROLES }));
  }

  private rollRemove(who: Actor, id: string): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 굴림 기록을 지울 수 있어요.");
    const i = this.rolls.findIndex((r) => r.id === id);
    if (i < 0) return fail("not_found", "이미 지워졌거나 없는 굴림이에요.");
    this.rolls.splice(i, 1);
    this.buffer = this.buffer.filter((o) => !((o.event.type === "roll.result" || o.event.type === "roll.hidden") && (o.event.data as { id?: string }).id === id));
    return ok(this.emit({ type: "roll.removed", data: { id } }, { roles: ALL_ROLES }));
  }

  private logRemove(who: Actor, n: number): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 기록을 지울 수 있어요.");
    const i = this.log.findIndex((e) => e.n === n);
    if (i < 0) return fail("not_found", "이미 지워졌거나 없는 기록이에요.");
    this.log.splice(i, 1);
    return ok(this.emit({ type: "log.removed", data: { n } }, { roles: ALL_ROLES }));
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
    // 되살린 토큰이 그사이 지워진 시트를 가리키고 있으면 연결을 푼다.
    const back = r.obj?.after;
    if (back?.characterId && !this.characters.has(back.characterId)) delete back.characterId;
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
    if (after) {
      // 시트 연결·HP 요약은 보는 사람마다 달라서, 같은 모양끼리 묶어 보낸다.
      const send = (type: "object.added" | "object.updated", ids: string[]) => {
        const groups = new Map<string, { obj: GameObject; users: string[] }>();
        for (const uid of ids) {
          const m = this.members.get(uid)!;
          const v = this.view(after, m);
          const k = JSON.stringify(v);
          const g = groups.get(k) ?? { obj: v, users: [] };
          g.users.push(uid);
          groups.set(k, g);
        }
        for (const g of groups.values()) out.push(this.emit({ type, data: g.obj }, { users: g.users }));
      };
      if (added.length) send("object.added", added);
      if (updated.length) send("object.updated", updated);
    }
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

  private rollRequest(who: Actor, d: Extract<ClientCommand, { type: "roll.request" }>["data"], allowSecret = false): Result {
    if (who.role === "spectator") return fail("forbidden", "관전자는 굴릴 수 없어요.");
    if (d.secret && who.role !== "kp" && !allowSecret) return fail("forbidden", "비밀 굴림은 GM만 쓸 수 있어요.");
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

    // 식에 db가 있으면 굴리는 캐릭터의 피해 보너스를 쓴다: 고른 캐릭터, 없으면 내 캐릭터가 하나일 때 그 캐릭터.
    let damageBonus: string | undefined;
    if (!d.skill && /db/i.test(expr)) {
      let who_c: Character | undefined;
      if (d.characterId) {
        who_c = this.characters.get(d.characterId);
        if (!who_c || !canSeeCharacter(who_c, who)) return fail("not_found", "캐릭터를 찾을 수 없어요.");
      } else {
        const mine = [...this.characters.values()].filter((c) => c.ownerId === who.userId);
        if (mine.length === 1) who_c = mine[0];
        else return fail("bad_roll", mine.length === 0 ? "db(피해 보너스)는 캐릭터 시트가 있어야 쓸 수 있어요. 캐릭터를 골라 주세요." : "db를 쓰려면 캐릭터를 골라 주세요.");
      }
      damageBonus = deriveCharacter(who_c as Character).damageBonus;
    }
    const rolled = rollExpression(expr, this.rng, damageBonus === undefined ? {} : { damageBonus });
    if (!rolled.ok) return fail("bad_roll", rolled.error);

    return this.logRoll(who, expr.trim(), label, rolled.outcome, d.secret, check ? { check } : {});
  }

  /** 굴림을 로그에 남기고 알린다. 비밀 굴림은 GM에게만 결과를 보낸다. */
  private logRoll(who: Actor, expr: string, label: string | undefined, outcome: RollLogEntry["outcome"], secret: boolean, meta: Partial<Pick<RollLogEntry, "check" | "pushOf" | "luckOf" | "damage">>, ...extra: Out[]): Result {
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
    // 세션 기록에는 모두에게 공개된 굴림만 남긴다(비밀 굴림은 어떤 경우에도 남기지 않는다).
    if (!secret) this.recordRoll(entry);

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

  /** 무기 피해를 굴린다. 식에 db가 있으면 시트의 피해 보너스를 굴려 넣는다(예: 1d6+db, 1d10+db/2). */
  private damageRoll(who: Actor, d: { characterId: string; weaponIndex: number }): Result {
    if (who.role === "spectator") return fail("forbidden", "관전자는 굴릴 수 없어요.");
    const c = this.characters.get(d.characterId);
    if (!c || !canSeeCharacter(c, who)) return fail("not_found", "캐릭터를 찾을 수 없어요.");
    const weapon = c.weapons?.[d.weaponIndex];
    if (!weapon) return fail("not_found", "무기를 찾을 수 없어요.");
    if (this.tooMany(`roll:${who.userId}`, this.rollsPerSecond)) return fail("rate_limited", "너무 빨리 굴리고 있어요. 잠시 뒤에 다시 해 주세요.");

    const text = weapon.damage.trim();
    const damageBonus = deriveCharacter(c).damageBonus;
    // 고정값(예: 5)은 주사위가 없는 식이라 엔진이 받지 않으므로 따로 센다.
    if (/^\d{1,3}$/.test(text)) {
      return this.logRoll(who, weapon.damage, `${c.name} · ${weapon.name} 피해`, { kind: "dice", expr: weapon.damage, rolls: [], modifier: Number(text), total: Number(text) }, false, { damage: true });
    }
    const rolled = rollExpression(text, this.rng, { damageBonus });
    if (!rolled.ok || rolled.outcome.kind !== "dice") return fail("bad_roll", rolled.ok ? "무기의 피해 식이 올바르지 않아요." : rolled.error);
    const o = rolled.outcome;
    // 피해는 0 밑으로 내려가지 않는다(피해 보너스가 마이너스인 약한 무기).
    const total = Math.max(0, o.total);
    return this.logRoll(who, weapon.damage, `${c.name} · ${weapon.name} 피해`, { ...o, expr: weapon.damage, total, modifier: total - o.rolls.reduce((a, b) => a + b, 0) }, false, { damage: true });
  }

  // ── 대항 판정·그룹 판정 ──────────────────────────────────

  /** 이름이 기능이 아니라 특성치·행운으로 굴리는 것인가(대항 판정이 비길 때 값 대신 다시 굴리는 기준) */
  private isCharacteristicRoll(c: Character, name: string): boolean {
    if (own(c.skills, name)) return false;
    return (CHARACTERISTIC_KEYS as readonly string[]).includes(name.toUpperCase()) || name === "행운" || name.toUpperCase() === "LUCK";
  }

  private rollSide(c: Character, name: string): OpposedSideOutcome | { error: string } {
    const target = targetValue(c, name);
    if (target === null) return { error: `${c.name}의 '${name}' 기능이 시트에 없어요.` };
    const percent = rollPercent(this.rng, 0);
    return { characterId: c.id, character: c.name, name, target, percent, level: evaluateLevel(percent.total, target) };
  }

  /**
   * 대항 판정: 두 시트가 각자 기능·특성치로 한 번씩 굴려 한 항목으로 남긴다. 규칙은 opposed.ts.
   * 보너스·페널티, 푸시, 행운은 없다(시트 판정 조건을 기록에 남기지 않는다). GM은 아무 시트나 고르고,
   * PL은 자기 시트와 다른 PL의 시트만 고른다(NPC 시트는 PL이 볼 수 없으니 GM이 시작한다).
   */
  private rollOpposed(who: Actor, d: Extract<ClientCommand, { type: "roll.opposed" }>["data"]): Result {
    if (who.role === "spectator") return fail("forbidden", "관전자는 굴릴 수 없어요.");
    if (d.secret && who.role !== "kp") return fail("forbidden", "비밀 굴림은 GM만 쓸 수 있어요.");
    const a = this.characters.get(d.a.characterId);
    let b: Character | undefined;
    if (d.b.userId !== undefined) {
      if (this.members.get(d.b.userId)?.role !== "pl") return fail("not_found", "그 참가자는 이 룸의 PL이 아니에요.");
      b = [...this.characters.values()].find((c) => c.ownerId === d.b.userId);
      if (!b) return fail("not_found", "그 PL은 아직 캐릭터가 없어요.");
    } else b = this.characters.get(d.b.characterId as string);
    if (!a || !b) return fail("not_found", "캐릭터를 찾을 수 없어요.");
    if (a.id === b.id) return fail("bad_roll", "서로 다른 두 캐릭터를 골라 주세요.");
    if (who.role === "pl") {
      if (a.ownerId !== who.userId) return fail("forbidden", "내 캐릭터로만 대항 판정을 시작할 수 있어요.");
      if (this.isNpcSheet(b)) return fail("forbidden", "상대가 GM의 캐릭터면 GM이 대항 판정을 시작해 주세요.");
    }
    if (this.tooMany(`roll:${who.userId}`, this.rollsPerSecond)) return fail("rate_limited", "너무 빨리 굴리고 있어요. 잠시 뒤에 다시 해 주세요.");
    const sa = this.rollSide(a, d.a.name);
    if ("error" in sa) return fail("bad_roll", sa.error);
    const sb = this.rollSide(b, d.b.name);
    if ("error" in sb) return fail("bad_roll", sb.error);
    const res = resolveOpposed(
      { level: sa.level, value: sa.target, characteristic: this.isCharacteristicRoll(a, d.a.name) },
      { level: sb.level, value: sb.target, characteristic: this.isCharacteristicRoll(b, d.b.name) },
    );
    const outcome: RollLogEntry["outcome"] = {
      kind: "opposed",
      expr: "대항 판정",
      a: sa,
      b: sb,
      winner: res.winner,
      reason: res.reason,
      statusQuo: res.winner === "none",
      summary: opposedSummary(sa, sb, res.winner, res.reason),
    };
    return this.logRoll(who, "대항 판정", `${a.name} · ${d.a.name} 대 ${b.name} · ${d.b.name}`, outcome, d.secret, {});
  }

  /** 그룹 판정(GM 전용): 캐릭터가 있는 PL들이 같은 기능으로 한꺼번에 굴린다. 한 항목으로 남고 푸시·행운은 없다. */
  private rollGroup(who: Actor, d: Extract<ClientCommand, { type: "roll.group" }>["data"]): Result {
    if (who.role !== "kp") return fail("forbidden", "그룹 판정은 GM만 요청할 수 있어요.");
    for (const uid of d.userIds ?? []) if (this.members.get(uid)?.role !== "pl") return fail("not_found", "그 참가자는 이 룸의 PL이 아니에요.");
    if (this.tooMany(`roll:${who.userId}`, this.rollsPerSecond)) return fail("rate_limited", "너무 빨리 굴리고 있어요. 잠시 뒤에 다시 해 주세요.");
    const entries: GroupEntry[] = [];
    const skipped: string[] = [];
    for (const c of this.characters.values()) {
      if (this.members.get(c.ownerId)?.role !== "pl") continue;
      if (d.userIds && !d.userIds.includes(c.ownerId)) continue;
      const side = this.rollSide(c, d.name);
      if ("error" in side) {
        skipped.push(c.name);
        continue;
      }
      entries.push({ characterId: c.id, character: c.name, target: side.target, percent: side.percent, level: side.level, success: meetsDifficulty(side.level, d.difficulty ?? "regular") });
    }
    if (entries.length === 0) return fail("not_found", skipped.length ? `${josa(d.name, "이/가")} 있는 PL 캐릭터가 없어요.` : "굴릴 PL 캐릭터가 없어요.");
    const outcome: RollLogEntry["outcome"] = {
      kind: "group",
      expr: `그룹 판정 · ${d.name}`,
      name: d.name,
      ...(d.difficulty ? { difficulty: d.difficulty } : {}),
      entries,
      skipped,
      successes: entries.filter((e) => e.success).length,
      summary: groupSummary(d.name, entries, skipped),
    };
    return this.logRoll(who, outcome.expr, `${d.name} 그룹 판정`, outcome, d.secret, {});
  }

  // ── 피해 적용·회복 ──────────────────────────────────────

  /** 시트에 상태(중상·기절·빈사·사망)를 넣는다. 빈사가 새로 시작되면 라운드를 0으로, 풀리면 지운다. */
  private setConditions(next: Character, conds: readonly Condition[]): void {
    const wasDying = next.conditions?.includes("dying") ?? false;
    const set = new Set(conds);
    if (set.has("dead")) {
      set.clear();
      set.add("dead");
    }
    if (set.has("dying")) set.delete("unconscious");
    if (set.size) next.conditions = [...set];
    else delete next.conditions;
    if (set.has("dying")) {
      if (!wasDying || next.dyingRounds === undefined) next.dyingRounds = 0;
    } else delete next.dyingRounds;
  }

  /** 시트가 바뀐 캐릭터가 전투 순서에 있으면 상태 표시를 다시 보낸다. */
  private initiativeRefresh(c: Character): Out[] {
    if (!this.initiative?.entries.some((e) => e.characterId === c.id)) return [];
    const r = this.initiativeOut();
    return r.ok ? r.out : [];
  }

  /**
   * GM이 피해를 캐릭터의 HP에 적용한다. 피해는 굴림 기록(rollId)의 합계나 직접 적은 값이고, 방어구를 먼저 뺀다.
   * 중상·기절·빈사·사망은 서버가 정한다(wounds.ts). 같은 굴림을 같은 캐릭터에게 두 번 적용하지는 못한다.
   */
  private damageApply(who: Actor, d: Extract<ClientCommand, { type: "damage.apply" }>["data"]): Result {
    if (who.role !== "kp") return fail("forbidden", "피해는 GM만 적용할 수 있어요.");
    const c = this.characters.get(d.characterId);
    if (!c) return fail("not_found", "캐릭터를 찾을 수 없어요.");
    let amount = d.amount ?? 0;
    if (d.rollId !== undefined) {
      const roll = this.rolls.find((r) => r.id === d.rollId);
      if (!roll || roll.outcome.kind !== "dice") return fail("not_found", "피해로 쓸 수 있는 굴림이 아니에요.");
      if (this.damageApplied.get(roll.id)?.has(c.id)) return fail("bad_roll", `이 피해는 이미 ${c.name}에게 적용했어요.`);
      amount = Math.max(0, roll.outcome.total);
    }
    if (c.conditions?.includes("dead")) return fail("bad_sheet", `${josa(c.name, "은/는")} 이미 사망했어요. 사망 표시를 풀면 다시 적용할 수 있어요.`);

    const maxHp = deriveCharacter(c).limits.hp;
    const r = applyDamage({ hp: c.hp, maxHp, conditions: c.conditions ?? [] }, amount, { armor: d.armor });
    const next = cloneCharacter(c);
    next.hp = r.hp;
    this.setConditions(next, r.conditions);
    if (r.hp !== c.hp || JSON.stringify(next.conditions) !== JSON.stringify(c.conditions)) next.rev = c.rev + 1;
    this.characters.set(c.id, next);
    if (d.rollId !== undefined) {
      const set = this.damageApplied.get(d.rollId) ?? new Set<string>();
      set.add(c.id);
      this.damageApplied.set(d.rollId, set);
      if (this.damageApplied.size > MAX_ROLL_LOG * 2) {
        const live = new Set(this.rolls.map((x) => x.id));
        for (const k of this.damageApplied.keys()) if (!live.has(k)) this.damageApplied.delete(k);
      }
    }
    const result: DamageApplied = {
      ...(d.rollId !== undefined ? { rollId: d.rollId } : {}),
      characterId: c.id,
      name: c.name,
      amount,
      armor: d.armor,
      dealt: r.dealt,
      hpBefore: r.hpBefore,
      hp: r.hp,
      kind: r.kind,
      newMajor: r.newMajor,
      massive: r.massive,
      conRoll: r.conRoll,
    };
    const aud = this.characterAudience(next);
    this.record("damage", "apply", `${c.name} 피해 ${r.dealt} (HP ${r.hpBefore} → ${r.hp})${DAMAGE_KIND_KO[r.kind] ? ` · ${DAMAGE_KIND_KO[r.kind]}` : ""}`, { audience: this.sheetAudience(c) });
    return ok(
      ...(next.rev !== c.rev ? [this.emit({ type: "character.updated", data: cloneCharacter(next) }, aud)] : []),
      this.emit({ type: "damage.applied", data: result }, aud),
      ...this.initiativeRefresh(next),
    );
  }

  /** GM이 HP를 회복한다: 응급처치(+1), 자연 회복, 직접 회복. 풀리는 상태는 wounds.ts의 기준을 따른다. */
  private hpHeal(who: Actor, d: Extract<ClientCommand, { type: "hp.heal" }>["data"]): Result {
    if (who.role !== "kp") return fail("forbidden", "회복은 GM만 적용할 수 있어요.");
    const c = this.characters.get(d.characterId);
    if (!c) return fail("not_found", "캐릭터를 찾을 수 없어요.");
    if (c.conditions?.includes("dead")) return fail("bad_sheet", `${josa(c.name, "은/는")} 사망해서 회복할 수 없어요. 사망 표시를 먼저 풀어 주세요.`);
    const maxHp = deriveCharacter(c).limits.hp;
    const r = applyHealing({ hp: c.hp, maxHp, conditions: c.conditions ?? [] }, d.kind, d.amount ?? 1);
    const next = cloneCharacter(c);
    next.hp = r.hp;
    this.setConditions(next, r.conditions);
    if (r.hp === c.hp && JSON.stringify(next.conditions) === JSON.stringify(c.conditions)) return ok();
    next.rev = c.rev + 1;
    this.characters.set(c.id, next);
    this.record("damage", "heal", `${c.name} 회복 +${next.hp - c.hp} (HP ${c.hp} → ${next.hp})`, { audience: this.sheetAudience(c) });
    return ok(this.emit({ type: "character.updated", data: cloneCharacter(next) }, this.characterAudience(next)), ...this.initiativeRefresh(next));
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
    this.record("sanity", "madness", `${c.name} 광기 증상: ${this.madnessTable[index]} (${duration}${d.mode === "realtime" ? "라운드" : "시간"})`, { audience: this.sheetAudience(c) });
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
    // 방금 공개한 경우는 공개 기록이 이미 남았으니 펼침은 따로 남기지 않는다.
    if (outs.length === 0 && users.length > 0) this.record("handout", "show", `핸드아웃 펼침: 「${h.title}」`, { audience: users });
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
    // 처음 보게 된 참가자가 있으면 공개로 기록한다(제목만. 본문은 남기지 않는다).
    const seers = after ? added.filter((u) => this.members.get(u)?.role !== "kp") : [];
    if (after && seers.length > 0) {
      const everyone = [...this.members.values()].filter((m) => m.role !== "kp").length;
      const names = seers.map((u) => this.members.get(u)?.name ?? "?").join(", ");
      this.record("handout", "reveal", `핸드아웃 공개: 「${after.title}」${seers.length < everyone ? ` → ${names}` : ""}`, { audience: seers, plText: `핸드아웃 공개: 「${after.title}」` });
    }
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
    const skills = newSkills();
    for (const s of d.skills) if (isSafeKey(s.name)) skills[s.name] = { value: s.value, grown: s.grown };
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
    const out: Out[] = [this.emit({ type: "character.removed", data: { id } }, this.characterAudience(c))];
    // 이 시트에 이어진 토큰은 연결을 푼다(토큰은 그대로 둔다).
    for (const o of this.objects.values()) {
      if (o.characterId !== id) continue;
      const before = { ...o };
      delete o.characterId;
      o.rev += 1;
      this.vitalsSig.delete(o.id);
      out.push(...this.fanOutObject(before, o));
    }
    return ok(...out);
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
    // GM이 "PL이 자기 수치 직접 수정"을 꺼 둔 룸: HP·MP·SAN·행운은 GM만 고친다. 굴림·행운 쓰기·SAN 판정은 따로 된다.
    if (who.role === "pl" && this.chatSettings.plSelfEdit === false && d.ops.some((o) => (STAT_PATHS as readonly string[]).includes(o.path))) {
      return fail("forbidden", "이 룸에서는 HP·MP·SAN·행운을 GM만 고칠 수 있어요. 바꿀 일이 있으면 GM에게 말해 주세요.");
    }
    for (const op of d.ops) {
      switch (op.path) {
        case "hp": {
          // HP를 직접 고쳐도 상태(중상·기절·빈사)는 서버가 HP 변화에서 정한다. 줄이면 피해, 늘리면 회복으로 본다(방어구·즉사 제외).
          if (next.conditions?.includes("dead")) return fail("bad_sheet", "사망한 캐릭터의 HP는 바꿀 수 없어요. GM이 사망 표시를 풀면 고칠 수 있어요.");
          const target = clamp(op.value !== undefined ? op.value : next.hp + (op.delta ?? 0), 0, limits.hp);
          const r = applyManualHp({ hp: next.hp, maxHp: limits.hp, conditions: next.conditions ?? [] }, target);
          next.hp = r.hp;
          this.setConditions(next, r.conditions);
          break;
        }
        case "mp":
        case "san":
        case "luck": {
          const cur = next[op.path];
          const target = op.value !== undefined ? op.value : cur + (op.delta ?? 0);
          next[op.path] = clamp(target, 0, limits[op.path]);
          break;
        }
        case "skill": {
          // 기능 값(처음 값·증감)은 GM만 고친다. PL은 자기 기능의 성장 표시만 바꾼다.
          if (who.role !== "kp" && (op.value !== undefined || op.delta !== undefined)) return fail("forbidden", "기능 값은 GM만 바꿀 수 있어요. 성장 표시만 직접 바꿀 수 있어요.");
          if (!isSafeKey(op.name)) return fail("bad_message", UNSAFE_KEY_MESSAGE);
          const cur = own(next.skills, op.name);
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
          if (who.role !== "kp") return fail("forbidden", "무기 목록은 GM만 바꿀 수 있어요.");
          next.weapons = op.value.map((w) => ({ ...w }));
          break;
        case "condition": {
          if (who.role !== "kp") return fail("forbidden", "중상·기절·빈사·사망 표시는 GM만 바꿀 수 있어요. HP가 바뀌면 서버가 알아서 표시해요.");
          const set = new Set(next.conditions ?? []);
          if (op.on) set.add(op.name);
          else set.delete(op.name);
          this.setConditions(next, [...set]);
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
    return ok(this.emit({ type: "character.updated", data: cloneCharacter(next) }, this.characterAudience(next)), ...this.initiativeRefresh(next));
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

  // ── 대화 ───────────────────────────────────────────────

  /** 귓속말로 부를 수 있는 사람들. 캐릭터 이름으로 부르는 것은 GM만 쓴다(PL의 시트 이름이 새지 않게). */
  private chatTargets(who: Actor): ChatTarget[] {
    const out: ChatTarget[] = [];
    for (const m of this.members.values()) {
      if (m.userId === who.userId || m.role === "spectator") continue;
      const names = [m.name];
      if (m.role === "kp") names.push("GM");
      else if (who.role === "kp") for (const c of this.characters.values()) if (c.ownerId === m.userId) names.push(c.name);
      out.push({ userId: m.userId, names });
    }
    return out;
  }

  /** "캐릭터로 말하기"를 풀어 화면에 보일 이름을 정한다. PL은 자기 시트만, GM은 아무 시트나 "GM"으로 말할 수 있다. */
  private chatSpeaker(who: Actor, sp: Extract<ClientCommand, { type: "chat.send" }>["data"]["speaker"]): { name: string; character?: Character } | { error: Result } {
    if (!sp) return { name: who.name };
    if ("gm" in sp) return who.role === "kp" ? { name: "GM" } : { error: fail("forbidden", "GM만 GM으로 말할 수 있어요.") };
    if (who.role === "spectator") return { error: fail("forbidden", "관전자는 캐릭터로 말할 수 없어요.") };
    const c = this.characters.get(sp.characterId);
    if (!c) return { error: fail("not_found", "캐릭터를 찾을 수 없어요.") };
    if (who.role === "pl" && c.ownerId !== who.userId) return { error: fail("forbidden", "내 캐릭터로만 말할 수 있어요.") };
    return { name: c.name, character: c };
  }

  private setChatSettings(who: Actor, d: { plWhisper: boolean; spectatorChat?: boolean; plSelfEdit?: boolean }): Result {
    if (who.role !== "kp") return fail("forbidden", "GM만 대화 설정을 바꿀 수 있어요.");
    this.chatSettings = {
      ...this.chatSettings,
      plWhisper: d.plWhisper,
      ...(d.spectatorChat !== undefined ? { spectatorChat: d.spectatorChat } : {}),
      ...(d.plSelfEdit !== undefined ? { plSelfEdit: d.plSelfEdit } : {}),
    };
    return ok(this.emit({ type: "settings.chat", data: { ...this.chatSettings } }, { roles: ALL_ROLES }));
  }

  /**
   * 대화 보내기. 글을 읽어 말·굴림(/r)·비밀 굴림(/hr)·귓속말(/w 또는 받는 사람 지정)로 나눈다.
   * 공개 범위는 여기서 정한다: 말·굴림은 모두, 귓속말은 보낸 사람과 받는 사람, 비밀 굴림은 GM과 굴린 사람.
   * GM도 자기와 무관한 PL끼리의 귓속말은 받지 못한다.
   */
  private chatSend(who: Actor, d: Extract<ClientCommand, { type: "chat.send" }>["data"]): Result {
    if (who.role === "spectator" && !this.chatSettings.spectatorChat) return fail("forbidden", "관전자 대화가 꺼져 있어요. GM이 켜면 말할 수 있어요.");
    const text = normalizeChatText(d.text);
    if (!text) return fail("bad_message", "보낼 내용을 적어 주세요.");
    if (text.length > CHAT_MAX_LENGTH) return fail("bad_message", `대화는 ${CHAT_MAX_LENGTH}자까지 보낼 수 있어요.`);
    if (this.tooMany(`chat:${who.userId}`, CHATS_PER_SECOND)) return fail("rate_limited", "너무 빨리 보내고 있어요. 잠시 뒤에 다시 해 주세요.");
    const input = d.to !== undefined ? ({ type: "whisper", to: d.to, text } as const) : parseChatInput(text, this.chatTargets(who));
    if (input.type === "error") return fail("bad_message", input.message);
    if (input.type === "help") return fail("bad_message", "도움말은 대화창의 ? 버튼에서 볼 수 있어요.");
    const sp = this.chatSpeaker(who, d.speaker);
    if ("error" in sp) return sp.error;

    const base = { session: this.sessionNumber, at: this.now(), userId: who.userId, name: sp.name, role: who.role } as const;
    const make = (m: Pick<ChatMessage, "kind" | "text"> & Partial<ChatMessage>): ChatMessage => {
      const seq = this.seq + 1;
      return { id: `m${seq}`, seq, ...base, ...m };
    };
    const post = (m: ChatMessage, audience: Audience): Out => {
      const out = this.emit({ type: "chat.posted", data: m }, audience);
      this.chat.push(cloneChat(m));
      if (this.chat.length > CHAT_KEEP) this.chat.splice(0, this.chat.length - CHAT_KEEP);
      return out;
    };

    if (input.type === "say") {
      const m = make({ kind: "say", text: input.text });
      // 세션 기록에는 모두에게 보이는 말만 남긴다.
      this.record("chat", "say", `${sp.name}: ${input.text}`, { chat: { name: sp.name, text: input.text } });
      return ok(post(m, { roles: ALL_ROLES }));
    }

    if (input.type === "whisper") {
      if (who.role === "spectator") return fail("forbidden", "관전자는 귓속말을 보낼 수 없어요.");
      const to = this.members.get(input.to);
      if (!to || to.role === "spectator") return fail("not_found", "받는 사람을 찾을 수 없어요.");
      if (to.userId === who.userId) return fail("bad_message", "나에게는 귓속말을 보낼 수 없어요.");
      if (who.role === "pl" && to.role === "pl" && !this.chatSettings.plWhisper) return fail("forbidden", "PL끼리 귓속말은 지금 꺼져 있어요. GM이 켜면 보낼 수 있어요.");
      const m = make({ kind: "whisper", text: input.text, to: { userId: to.userId, name: to.name } });
      return ok(post(m, { users: [who.userId, to.userId] }));
    }

    // 굴림
    if (who.role === "spectator") return fail("forbidden", "관전자는 굴릴 수 없어요.");
    if (this.status !== "ACTIVE") return fail(this.status === "IDLE" ? "idle" : "paused", this.status === "IDLE" ? "세션을 시작한 뒤에 굴릴 수 있어요." : "일시정지 중에는 굴릴 수 없어요.");
    const rolled = this.rollRequest(who, { expr: input.expr, secret: input.secret, ...(sp.character ? { characterId: sp.character.id } : {}) }, true);
    if (!rolled.ok) return rolled;
    const entry = this.rolls[this.rolls.length - 1] as RollLogEntry;
    const m = make({ kind: input.secret ? "secret" : "roll", text: entry.expr, roll: { rollId: entry.id, expr: entry.expr, result: describeOutcome(entry.outcome) } });
    return ok(...rolled.out, post(m, input.secret ? { roles: ["kp"], users: [who.userId] } : { roles: ALL_ROLES }));
  }

  /** 접속할 때 줄 최근 대화(이 사람이 볼 수 있는 것만) */
  chatHistory(viewer: Pick<Member, "userId" | "role">, limit = CHAT_HISTORY_ON_JOIN): ChatMessage[] {
    return this.chat.filter((m) => canSeeChat(m, viewer)).slice(-limit).map(cloneChat);
  }

  /** 이전 대화 더 보기: seq가 before보다 앞인 것 중 최근 limit개(오래된 순) */
  chatPage(viewer: Pick<Member, "userId" | "role">, before: number, limit = 50): { messages: ChatMessage[]; hasMore: boolean } {
    const older = this.chat.filter((m) => m.seq < before && canSeeChat(m, viewer));
    const n = Math.min(Math.max(1, Math.floor(limit)), CHAT_PAGE_MAX);
    const page = older.slice(Math.max(0, older.length - n));
    return { messages: page.map(cloneChat), hasMore: older.length > page.length };
  }

  /** 이 사용자의 룸 안 역할(참가한 적이 없으면 null) */
  roleOf(userId: string): Role | null {
    return this.members.get(userId)?.role ?? null;
  }

  // ── 세션 기록 ───────────────────────────────────────────

  /** 보는 사람이 볼 수 있는 세션 기록을 조건에 맞게 돌려준다. */
  logFor(viewer: LogViewer, q: LogQuery = {}): LogPage {
    return queryLog(this.log, viewer, q);
  }

  private record(kind: LogKind, type: string, text: string, opts: { plText?: string; audience?: LogEntry["audience"]; roll?: RollRow; chat?: { name: string; text: string } } = {}): void {
    const scene = this.scenes.get(this.activeSceneId)?.name;
    const e: LogEntry = {
      n: ++this.logN,
      at: this.now(),
      session: this.sessionNumber,
      kind,
      type,
      text,
      audience: opts.audience ?? "all",
      ...(opts.plText !== undefined ? { plText: opts.plText } : {}),
      ...(scene ? { scene } : {}),
      ...(opts.roll ? { roll: opts.roll } : {}),
      ...(opts.chat ? { chat: opts.chat } : {}),
    };
    this.log.push(e);
    if (this.log.length > LOG_KEEP) this.log.splice(0, this.log.length - LOG_KEEP);
  }

  private recordRoll(entry: RollLogEntry): void {
    const row = rollRow(entry);
    if (entry.outcome.kind === "san") this.record("sanity", "san", `${row.who}: ${row.result}`, { roll: row });
    else this.record("roll", "roll", `${row.who} ${row.expr} → ${row.result}`, { roll: row });
  }

  /** 시트에 얽힌 기록을 볼 수 있는 사람: PL의 시트면 그 주인(과 GM), GM의 시트(NPC)면 GM뿐 */
  private sheetAudience(c: Pick<Character, "ownerId">): LogEntry["audience"] {
    return this.isNpcSheet(c) ? "gm" : [c.ownerId];
  }

  // ── 내부 ───────────────────────────────────────────────

  private memberList(): Member[] {
    return [...this.members.values()].map((m) => ({ ...m }));
  }

  /** 모든 참가자(관전자 포함). 서버 안(입장 판단·방 목록)에서만 쓴다. 보내는 목록은 memberListFor다. */
  listMembers(): Member[] {
    return this.memberList();
  }

  /** 보는 사람에게 알려 줄 참가자. 관전자는 GM에게만 보이고, 관전자 본인은 자기 자신만 안다(관전자 수는 GM만 안다). */
  private memberListFor(viewer: Pick<Member, "userId" | "role">): Member[] {
    return this.memberList().filter((m) => m.role !== "spectator" || viewer.role === "kp" || m.userId === viewer.userId);
  }

  /** 참가자 목록이 바뀌었다는 알림. 관전자가 있으면 GM에게만 전체 목록을, 나머지에게는 관전자를 뺀 목록을 보낸다. */
  private presenceOuts(): Out[] {
    const specs = [...this.members.values()].filter((m) => m.role === "spectator");
    if (specs.length === 0) return [this.emit({ type: "presence", data: { members: this.memberList() } }, { roles: ALL_ROLES })];
    const out: Out[] = [this.emit({ type: "presence", data: { members: this.memberList() } }, { roles: ["kp"] })];
    out.push(this.emit({ type: "presence", data: { members: this.memberListFor({ userId: "", role: "pl" }) } }, { roles: ["pl"] }));
    for (const sp of specs) out.push(this.emit({ type: "presence", data: { members: this.memberListFor(sp) } }, { users: [sp.userId] }));
    return out;
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

const cloneChat = (m: ChatMessage): ChatMessage => ({ ...m, ...(m.to ? { to: { ...m.to } } : {}), ...(m.roll ? { roll: { ...m.roll } } : {}) });

const cloneLog = (e: LogEntry): LogEntry => ({
  ...e,
  audience: Array.isArray(e.audience) ? [...e.audience] : e.audience,
  ...(e.roll ? { roll: { ...e.roll, tags: [...e.roll.tags] } } : {}),
  ...(e.chat ? { chat: { ...e.chat } } : {}),
});

const cloneHandout = (h: Handout): Handout => ({ ...h, visibleTo: Array.isArray(h.visibleTo) ? [...h.visibleTo] : h.visibleTo });

const cloneCharacter = (c: Character): Character => ({
  ...c,
  ...(c.weapons ? { weapons: c.weapons.map((w) => ({ ...w })) } : {}),
  ...(c.conditions ? { conditions: [...c.conditions] } : {}),
  ...(c.sanDay ? { sanDay: { ...c.sanDay } } : {}),
  characteristics: { ...c.characteristics },
  skills: Object.fromEntries(ownSafeEntries(c.skills).map(([k, v]) => [k, { ...v }])),
});

/** 기능 목록을 담을 빈 객체. 원형이 없어서 어떤 이름을 넣어도 Object.prototype에 닿지 않는다. */
const newSkills = (): Character["skills"] => Object.create(null) as Character["skills"];

/** 시트 판정의 CC 표기. */
const skillExpr = (value: number, bonus: number, difficulty?: "regular" | "hard" | "extreme") => {
  const suffix = difficulty === "hard" ? "h" : difficulty === "extreme" ? "e" : difficulty === "regular" ? "r" : "";
  return `CC${bonus !== 0 ? `(${bonus})` : ""}<=${value}${suffix}`;
};

const ok = (...out: Out[]): Result => ({ ok: true, out });
const fail = (code: ErrorCode, message: string): Result => ({ ok: false, code, message });
