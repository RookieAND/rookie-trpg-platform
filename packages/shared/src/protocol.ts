import { z } from "zod";
import { MAX_SUM_EXPR_LENGTH, parseCommand, type Difficulty, type RollOutcome } from "./dice";
import { CHARACTERISTIC_KEYS, CONDITIONS, MADNESS_KINDS, MAX_WEAPONS, STAT_PATHS, type Character } from "./sheet";

export type Role = "kp" | "pl" | "spectator";
/** IDLE: 진행 중인 세션이 없음(첫 시작 전, 또는 세션 종료 뒤). KP는 이때 장면을 준비할 수 있다. */
export type SessionStatus = "IDLE" | "ACTIVE" | "PAUSED";
export type Layer = "background" | "object" | "gm";
export type Visibility = "all" | "gm" | string[]; // string[] = 보이는 사용자 id 목록

/** 맵 한 장. PL에게는 활성 장면만 알려 주고, 나머지는 KP가 준비한다. */
export interface Scene {
  id: string;
  name: string;
  /** 배경 이미지 id (업로드한 이미지) */
  background?: string;
  /** 세션을 시작하면 처음 보이는 장면. KP만 안다. */
  start?: boolean;
  /** 이 장면으로 바뀔 때 틀 배경음(음원 라이브러리의 트랙 id). KP만 안다. */
  bgmTrackId?: string;
  /** 안개. KP만 설정과 밝힌 영역을 안다. */
  fog?: SceneFog;
  /** 안개가 켜진 활성 장면에서 지금 보이는 원들(밝힌 영역 + 시야 토큰). KP가 아닌 사람에게만 온다. */
  fogAreas?: FogArea[];
  /** 한 번이라도 시야에 들어왔던 곳(탐험 기록). 안개가 켜진 활성 장면에서 KP가 아닌 사람에게만 온다. */
  fogExplored?: FogArea[];
}

export const MAX_FOG_ZONES = 60;
export const FOG_MAX_RADIUS = 600;
/** 장면마다 남기는 탐험 기록 원의 최대 개수(넘치면 오래된 것부터 버린다) */
export const MAX_FOG_EXPLORED = 200;

export interface FogZone {
  id: string;
  x: number;
  y: number;
  r: number;
}
export interface FogArea {
  x: number;
  y: number;
  r: number;
}
export interface SceneFog {
  enabled: boolean;
  zones: FogZone[];
  /** 한 번이라도 보였던 곳. 서버가 시야가 바뀔 때마다 쌓는다. */
  explored?: FogArea[];
}

export type Transition = "cut" | "fade";

/** 화면 효과를 내는 판정 단계 */
export const EFFECT_LEVELS = ["critical", "extreme", "hard", "fumble"] as const;
export type EffectLevel = (typeof EFFECT_LEVELS)[number];
export interface EffectSetting {
  enabled: boolean;
  /** 1 약하게, 2 보통, 3 강하게 */
  intensity: 1 | 2 | 3;
}
export type EffectSettings = Record<EffectLevel, EffectSetting>;

/** 처음 룸을 만들 때 값. 어려운 성공은 잦아서 꺼 둔다. */
export const DEFAULT_EFFECTS: EffectSettings = {
  critical: { enabled: true, intensity: 3 },
  extreme: { enabled: true, intensity: 2 },
  hard: { enabled: false, intensity: 1 },
  fumble: { enabled: true, intensity: 3 },
};

/** 장면이 하나뿐일 때와 옛 저장 데이터가 쓰는 기본 장면 id */
export const DEFAULT_SCENE_ID = "main";

export interface GameObject {
  id: string;
  /** 이 오브젝트가 놓인 장면 */
  sceneId: string;
  kind: "token" | "prop";
  name: string;
  /** 토큰·소품에 입힌 이미지 id */
  image?: string;
  x: number;
  y: number;
  layer: Layer;
  visibleTo: Visibility;
  /** 시야 반지름. 안개가 켜진 장면에서 이 둘레가 모두에게 보인다. */
  vision?: number;
  /** 이 오브젝트를 움직일 수 있는 사용자(토큰의 주인). KP는 항상 가능. */
  ownerId?: string;
  locked: boolean;
  /** 변경될 때마다 1씩 오른다. 오래된 명령을 거절하는 데 쓴다. */
  rev: number;
}

export interface RollLogEntry {
  id: string;
  userId: string;
  userName: string;
  expr: string;
  outcome: RollOutcome;
  /** 시트로 굴렸을 때 "캐릭터 · 기능" 표시 */
  label?: string;
  /** 시트로 굴린 판정의 조건. 푸시 굴림에 그대로 쓴다. */
  check?: { characterId: string; name: string; bonus: number; difficulty?: "regular" | "hard" | "extreme" };
  /** 이 굴림은 해당 굴림의 푸시다 */
  pushOf?: string;
  /** 이 굴림은 해당 굴림에 행운을 쓴 결과다 */
  luckOf?: string;
  /** 굴린 세션 번호 */
  session: number;
  /** KP가 비밀로 굴린 결과. KP 외에는 받지 못한다. */
  secret: boolean;
  at: number;
}

/** KP가 PL에게 보여 주는 자료(편지, 메모, 단서). gm이면 초안으로 KP만 본다. */
export interface Handout {
  id: string;
  title: string;
  body: string;
  /** 핸드아웃에 붙인 이미지 id */
  image?: string;
  visibleTo: Visibility;
  /** KP 전용 노트. 공개 범위를 바꾸거나 비트·분기에 붙일 수 없어서 실수로 새어 나가지 않는다. */
  kpOnly?: boolean;
  rev: number;
}

export interface Member {
  userId: string;
  name: string;
  role: Role;
  online: boolean;
}

/** 전투 순서의 한 칸. 시트가 있는 캐릭터는 characterId로 이어지고, NPC는 이름과 DEX만 둔다. */
export interface InitiativeEntry {
  id: string;
  name: string;
  dex: number;
  characterId?: string;
}

/** 전투 순서(DEX 높은 순). turn은 지금 차례인 칸의 위치, round는 몇 라운드째인지. */
export interface Initiative {
  entries: InitiativeEntry[];
  turn: number;
  round: number;
}

export const MAX_INITIATIVE_ENTRIES = 30;

// ── 음향 ──────────────────────────────────────────────────

export const AUDIO_KINDS = ["bgm", "se"] as const;
export type AudioKind = (typeof AUDIO_KINDS)[number];
export const AUDIO_KIND_LABEL_KO: Record<AudioKind, string> = { bgm: "배경음", se: "효과음" };
export const MAX_AUDIO_TRACKS = 30;

/** KP의 음원 라이브러리 한 줄. 이름은 KP에게만 보인다(참가자에게는 파일 id만 간다). */
export interface AudioTrack {
  id: string;
  label: string;
  kind: AudioKind;
  /** 업로드한 오디오 파일 id */
  assetId: string;
  /** 기본 볼륨 0~100 */
  volume: number;
}

/** 지금 흐르는 배경음. startedAt은 서버 시각이라 늦게 들어온 사람도 같은 위치부터 듣는다. */
export interface BgmState {
  assetId: string;
  volume: number;
  startedAt: number;
  fadeMs: number;
}

// ── 세션 흐름(KP 전용) ────────────────────────────────────

export const BEAT_KINDS = ["start", "progress", "ending"] as const;
export type BeatKind = (typeof BEAT_KINDS)[number];
export const BEAT_KIND_LABEL_KO: Record<BeatKind, string> = { start: "시작", progress: "진행", ending: "엔딩" };
export const MAX_BEATS = 40;
export const MAX_BRANCHES = 80;
export const MAX_BEAT_HANDOUTS = 10;

/** 비트: 시나리오의 한 단계. 들어갈 때 장면을 바꾸고 핸드아웃을 펼친다(큐). */
export interface Beat {
  id: string;
  name: string;
  kind: BeatKind;
  /** KP 메모. 참가자에게는 가지 않는다. */
  memo: string;
  sceneId?: string;
  handoutIds: string[];
  /** 엔딩 비트가 끝날 때 쓸 SAN 보상 식 */
  sanReward?: string;
  /** 들어갈 때 틀 배경음(음원 라이브러리의 BGM) */
  bgmTrackId?: string;
}

export type BranchCondition =
  | { type: "manual" }
  | { type: "roll"; skill: string; atLeast: Difficulty }
  | { type: "stat"; stat: "hp" | "san" | "luck"; atMost: number }
  | { type: "handout"; handoutId: string };

export interface Branch {
  id: string;
  from: string;
  to: string;
  label: string;
  condition: BranchCondition;
}

export interface FlowSuggestion {
  branchId: string;
  reason: string;
}

export interface Flow {
  beats: Beat[];
  branches: Branch[];
  /** 지금 있는 비트 */
  current: string | null;
  suggestions: FlowSuggestion[];
}

export interface Snapshot {
  roomId: string;
  seq: number;
  sessionStatus: SessionStatus;
  sessionNumber: number;
  objects: GameObject[];
  members: Member[];
  rolls: RollLogEntry[];
  /** 내가 볼 수 있는 시트(내 것, KP는 전부) */
  characters: Character[];
  scenes: Scene[];
  activeSceneId: string;
  effects: EffectSettings;
  handouts: Handout[];
  /** 광기 증상표. KP에게만 담아 보낸다(다른 사람은 빈 배열). */
  madnessTable: string[];
  /** 진행 중인 전투 순서. 없으면 null. 모두에게 보인다. */
  initiative: Initiative | null;
  /** 세션 흐름. KP에게만 담아 보낸다(다른 사람은 null). */
  flow: Flow | null;
  /** 음원 라이브러리. KP에게만 담아 보낸다. */
  audioLibrary: AudioTrack[];
  /** 지금 흐르는 배경음. 없으면 null. */
  bgm: BgmState | null;
  /** 서버의 현재 시각(ms). 클라이언트가 시계 차이를 맞추는 데 쓴다. */
  now: number;
}

// ── 클라이언트 → 서버 ─────────────────────────────────────

export const MAX_MADNESS_ENTRIES = 10;

const id = z.string().min(1).max(64);
const coord = z.number().finite().min(-100_000).max(100_000);

/** 업로드한 이미지의 id. 서버가 정한 32자리 16진수. */
export const imageId = z.string().regex(/^[a-f0-9]{32}$/);

const visibility = z.union([z.literal("all"), z.literal("gm"), z.array(id).max(32)]);

/** 피해 식: 1d6, 1d8+2, 1d6+db(피해 보너스 더하기), 고정값(5)을 받는다. */
export const isDamageExpr = (text: string) => {
  const t = text.trim().toLowerCase().replace(/\+db$/, "");
  if (/^\d{1,3}$/.test(t)) return true;
  const p = parseCommand(t);
  return p.ok && p.command.kind === "dice";
};

export const weaponSchema = z.object({
  name: z.string().trim().min(1).max(30),
  skill: z.string().trim().min(1).max(30),
  damage: z.string().trim().min(1).max(20).refine(isDamageExpr, { message: "피해는 1d6+db처럼 주사위 식으로 적어 주세요." }),
});

/** 캐릭터를 만들 때 받는 값. 보관함과 룸 등록이 같은 규격을 쓴다. */
export const characterInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  age: z.number().int().min(15).max(90),
  occupation: z.string().max(40).default(""),
  characteristics: z.object(
    Object.fromEntries(CHARACTERISTIC_KEYS.map((k) => [k, z.number().int().min(1).max(99)])) as Record<
      (typeof CHARACTERISTIC_KEYS)[number],
      z.ZodNumber
    >,
  ),
  luck: z.number().int().min(0).max(99).optional(),
  hp: z.number().int().min(0).max(99).optional(),
  mp: z.number().int().min(0).max(99).optional(),
  san: z.number().int().min(0).max(99).optional(),
  skills: z
    .array(z.object({ name: z.string().trim().min(1).max(30), value: z.number().int().min(0).max(100), grown: z.boolean().default(false) }))
    .max(150)
    .default([]),
  notes: z.string().max(2000).default(""),
  backstory: z.string().max(2000).default(""),
  possessions: z.string().max(1000).default(""),
  weapons: z.array(weaponSchema).max(MAX_WEAPONS).default([]),
});

export type CharacterInput = z.input<typeof characterInputSchema>;
export type CharacterData = z.output<typeof characterInputSchema>;

const delta = z.number().int().min(-200).max(200);

/** 시트 한 칸을 바꾸는 연산. value는 값 지정, delta는 증감이다(마지막 값이 이긴다). */
export const sheetOp = z.union([
  z
    .object({ path: z.enum(STAT_PATHS), value: z.number().int().min(0).max(999).optional(), delta: delta.optional() })
    .refine((o) => (o.value === undefined) !== (o.delta === undefined), { message: "value와 delta 중 하나만 써 주세요." }),
  z
    .object({
      path: z.literal("skill"),
      name: z.string().min(1).max(30),
      value: z.number().int().min(0).max(999).optional(),
      delta: delta.optional(),
      grown: z.boolean().optional(),
    })
    .refine((o) => o.value !== undefined || o.delta !== undefined || o.grown !== undefined, { message: "바꿀 값이 없어요." })
    .refine((o) => !(o.value !== undefined && o.delta !== undefined), { message: "value와 delta는 함께 쓸 수 없어요." }),
  z.object({ path: z.literal("notes"), value: z.string().max(2000) }),
  z.object({ path: z.literal("madness"), value: z.enum(MADNESS_KINDS) }),
  z.object({ path: z.literal("backstory"), value: z.string().max(2000) }),
  z.object({ path: z.literal("possessions"), value: z.string().max(1000) }),
  z.object({ path: z.literal("weapons"), value: z.array(weaponSchema).max(MAX_WEAPONS) }),
  z.object({ path: z.literal("condition"), name: z.enum(CONDITIONS), on: z.boolean() }),
]);

export type SheetOp = z.infer<typeof sheetOp>;

export const clientCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("object.add"),
    data: z.object({
      kind: z.enum(["token", "prop"]),
      name: z.string().min(1).max(40),
      image: imageId.optional(),
      x: coord,
      y: coord,
      layer: z.enum(["background", "object", "gm"]).default("object"),
      visibleTo: visibility.default("all"),
      ownerId: id.optional(),
      /** 비우면 지금 활성 장면에 놓는다. */
      sceneId: id.optional(),
      /** 켜면 (x,y)에서 가장 가까운, 같은 장면의 다른 오브젝트와 겹치지 않는 빈자리에 놓는다. */
      autoPlace: z.boolean().optional(),
    }),
  }),
  z.object({
    type: z.literal("object.move"),
    data: z.object({ id, x: coord, y: coord, rev: z.number().int().min(0) }),
  }),
  z.object({
    type: z.literal("object.update"),
    data: z.object({
      id,
      name: z.string().min(1).max(40).optional(),
      /** 소유자(룸의 PL). null이면 소유자를 푼다(NPC). */
      ownerId: id.nullable().optional(),
      /** null이면 이미지를 뗀다. */
      image: imageId.nullable().optional(),
      layer: z.enum(["background", "object", "gm"]).optional(),
      visibleTo: visibility.optional(),
      locked: z.boolean().optional(),
      /** 시야 반지름. 0이면 없앤다. */
      vision: z.number().int().min(0).max(FOG_MAX_RADIUS).optional(),
    }),
  }),
  z.object({ type: z.literal("scene.fog"), data: z.object({ id, enabled: z.boolean() }) }),
  z.object({ type: z.literal("fog.reveal"), data: z.object({ sceneId: id, x: coord, y: coord, r: z.number().int().min(10).max(FOG_MAX_RADIUS) }) }),
  z.object({ type: z.literal("fog.remove"), data: z.object({ sceneId: id, zoneId: id }) }),
  z.object({ type: z.literal("fog.clear"), data: z.object({ sceneId: id }) }),
  z.object({ type: z.literal("fog.forget"), data: z.object({ sceneId: id }) }),
  z.object({ type: z.literal("object.remove"), data: z.object({ id }) }),
  z.object({
    type: z.literal("roll.request"),
    data: z
      .object({
        expr: z.string().min(1).max(64).optional(),
        secret: z.boolean().default(false),
        /** 시트의 기능·특성치로 굴린다. 목표값은 서버가 시트에서 읽는다. */
        skill: z
          .object({
            characterId: id,
            name: z.string().min(1).max(30),
            bonus: z.number().int().min(-2).max(2).default(0),
            difficulty: z.enum(["regular", "hard", "extreme"]).optional(),
          })
          .optional(),
      })
      .refine((d) => d.expr !== undefined || d.skill !== undefined, { message: "expr 또는 skill이 필요해요." }),
  }),
  z.object({
    type: z.literal("character.add"),
    data: characterInputSchema.extend({
      /** NPC처럼 다른 사람 몫으로 만들 때. KP만 쓸 수 있다. */
      ownerId: id.optional(),
      /** 보관함에서 불러온 시트면 원본 id. 세션이 끝난 뒤 되돌려 쓸 때 쓴다. */
      vaultId: id.optional(),
    }),
  }),
  z.object({
    type: z.literal("handout.create"),
    data: z.object({
      title: z.string().trim().min(1).max(60),
      body: z.string().max(4000).default(""),
      image: imageId.optional(),
      visibleTo: visibility.default("gm"),
      kpOnly: z.boolean().optional(),
    }),
  }),
  z.object({
    type: z.literal("handout.update"),
    data: z.object({
      id,
      title: z.string().trim().min(1).max(60).optional(),
      body: z.string().max(4000).optional(),
      image: imageId.nullable().optional(),
      visibleTo: visibility.optional(),
      kpOnly: z.boolean().optional(),
    }),
  }),
  z.object({ type: z.literal("handout.remove"), data: z.object({ id }) }),
  /** KP가 핸드아웃을 보는 사람 모두의 화면에 바로 펼친다. */
  z.object({ type: z.literal("handout.show"), data: z.object({ id }) }),
  z.object({ type: z.literal("character.remove"), data: z.object({ id }) }),
  z.object({
    type: z.literal("sheet.patch"),
    data: z.object({
      characterId: id,
      ops: z.array(sheetOp).min(1).max(20),
    }),
  }),
  /** KP가 판정 단계별 효과를 켜고 끄고 세기를 정한다. */
  z.object({
    type: z.literal("settings.effects"),
    data: z
      .object({
        level: z.enum(EFFECT_LEVELS),
        enabled: z.boolean().optional(),
        intensity: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
      })
      .refine((d) => d.enabled !== undefined || d.intensity !== undefined, { message: "바꿀 값이 없어요." }),
  }),
  z.object({ type: z.literal("scene.create"), data: z.object({ name: z.string().trim().min(1).max(40) }) }),
  z.object({ type: z.literal("scene.rename"), data: z.object({ id, name: z.string().trim().min(1).max(40) }) }),
  z.object({ type: z.literal("scene.setStart"), data: z.object({ id: id.nullable() }) }),
  z.object({ type: z.literal("scene.setBgm"), data: z.object({ id, trackId: id.nullable() }) }),
  z.object({ type: z.literal("scene.background"), data: z.object({ id, image: imageId.nullable() }) }),
  z.object({ type: z.literal("scene.remove"), data: z.object({ id }) }),
  z.object({ type: z.literal("scene.activate"), data: z.object({ id, transition: z.enum(["cut", "fade"]).default("cut") }) }),
  /** 무기의 피해를 굴린다(피해 보너스 포함). */
  z.object({ type: z.literal("damage.roll"), data: z.object({ characterId: id, weaponIndex: z.number().int().min(0).max(MAX_WEAPONS - 1) }) }),
  /** 실패한 시트 판정을 한 번 더 굴린다(푸시). 굴린 사람이나 KP가 할 수 있다. */
  z.object({ type: z.literal("roll.push"), data: z.object({ rollId: id }) }),
  /** 실패한 시트 판정을 성공으로 바꿀 만큼 행운을 쓴다. */
  z.object({ type: z.literal("luck.spend"), data: z.object({ rollId: id }) }),
  /** SAN 체크. loss는 "성공 시/실패 시" 형식(예: 0/1d6). 시트 주인이나 KP가 할 수 있다. */
  z.object({ type: z.literal("san.check"), data: z.object({ characterId: id, loss: z.string().trim().min(1).max(30) }) }),
  /** 광기 증상표를 통째로 바꾼다(KP 전용). 한 줄이 증상 하나다. */
  z.object({
    type: z.literal("flow.beat.upsert"),
    data: z.object({
      id: id.optional(),
      name: z.string().trim().min(1).max(40),
      kind: z.enum(BEAT_KINDS),
      memo: z.string().max(1000).default(""),
      sceneId: id.optional(),
      handoutIds: z.array(id).max(MAX_BEAT_HANDOUTS).default([]),
      sanReward: z.string().trim().max(MAX_SUM_EXPR_LENGTH).optional(),
      bgmTrackId: id.optional(),
    }),
  }),
  z.object({ type: z.literal("flow.beat.remove"), data: z.object({ id }) }),
  z.object({
    type: z.literal("flow.branch.upsert"),
    data: z.object({
      id: id.optional(),
      from: id,
      to: id,
      label: z.string().trim().min(1).max(40),
      condition: z.discriminatedUnion("type", [
        z.object({ type: z.literal("manual") }),
        z.object({ type: z.literal("roll"), skill: z.string().trim().min(1).max(30), atLeast: z.enum(["regular", "hard", "extreme", "critical"]) }),
        z.object({ type: z.literal("stat"), stat: z.enum(["hp", "san", "luck"]), atMost: z.number().int().min(0).max(999) }),
        z.object({ type: z.literal("handout"), handoutId: id }),
      ]),
    }),
  }),
  z.object({ type: z.literal("flow.branch.remove"), data: z.object({ id }) }),
  z.object({ type: z.literal("flow.goto"), data: z.object({ beatId: id }) }),
  z.object({ type: z.literal("flow.ending.choose"), data: z.object({ beatId: id }) }),
  z.object({ type: z.literal("flow.dismiss"), data: z.object({ branchId: id }) }),
  z.object({
    type: z.literal("audio.track.add"),
    data: z.object({ label: z.string().trim().min(1).max(40), kind: z.enum(AUDIO_KINDS), assetId: imageId, volume: z.number().int().min(0).max(100).default(80) }),
  }),
  z.object({ type: z.literal("audio.track.remove"), data: z.object({ id }) }),
  z.object({
    type: z.literal("audio.play"),
    data: z.object({ trackId: id, volume: z.number().int().min(0).max(100).optional(), fadeMs: z.number().int().min(0).max(10_000).default(0) }),
  }),
  z.object({ type: z.literal("audio.stop"), data: z.object({ fadeMs: z.number().int().min(0).max(10_000).default(0) }) }),
  z.object({ type: z.literal("audio.volume"), data: z.object({ volume: z.number().int().min(0).max(100) }) }),
  z.object({ type: z.literal("initiative.start"), data: z.object({}) }),
  z.object({ type: z.literal("initiative.add"), data: z.object({ name: z.string().trim().min(1).max(30), dex: z.number().int().min(0).max(200) }) }),
  z.object({ type: z.literal("initiative.remove"), data: z.object({ id }) }),
  z.object({ type: z.literal("initiative.dex"), data: z.object({ id, dex: z.number().int().min(0).max(200) }) }),
  z.object({ type: z.literal("initiative.next"), data: z.object({}) }),
  z.object({ type: z.literal("initiative.end"), data: z.object({}) }),
  z.object({ type: z.literal("settings.madness"), data: z.object({ entries: z.array(z.string().trim().min(1).max(120)).max(MAX_MADNESS_ENTRIES) }) }),
  /** 증상표에서 증상을 하나 굴린다(KP 전용). 결과는 시트 주인과 KP만 본다. */
  z.object({ type: z.literal("madness.roll"), data: z.object({ characterId: id, mode: z.enum(["realtime", "summary"]).default("realtime") }) }),
  /** 하루가 지났다고 기록한다(KP 전용). characterId를 생략하면 모두. */
  z.object({ type: z.literal("san.newDay"), data: z.object({ characterId: id.optional() }).default({}) }),
  z.object({ type: z.literal("session.start"), data: z.object({}).default({}) }),
  z.object({ type: z.literal("session.pause"), data: z.object({}).default({}) }),
  z.object({ type: z.literal("session.resume"), data: z.object({}).default({}) }),
  z.object({
    type: z.literal("session.end"),
    data: z
      .object({
        /** 엔딩 이름. 비우면 기록하지 않는다. */
        ending: z.string().trim().max(40).optional(),
        /** 참가자마다 한 번씩 굴려 SAN에 더하는 보상 식(예: 1d6, 1d6+1d4). */
        sanReward: z.string().trim().max(MAX_SUM_EXPR_LENGTH).optional(),
        /** 성장 표시가 된 기능마다 성장 굴림을 한다. */
        growth: z.boolean().optional(),
      })
      .default({}),
  }),
]);

/** 광기 증상 굴림 결과. mode가 realtime이면 duration은 라운드, summary면 시간이다. */
export interface MadnessResult {
  characterId: string;
  name: string;
  mode: "realtime" | "summary";
  duration: number;
  index: number;
  symptom: string;
}

/** 세션 종료 정산 결과. 모두에게 공개한다(굴림 로그와 같은 성격). */
export interface EndSummary {
  ending?: string;
  sanRewards?: Array<{ characterId: string; name: string; roll: number; before: number; after: number }>;
  growth?: Array<{ characterId: string; name: string; skill: string; roll: number; before: number; after: number; success: boolean }>;
}

export type ClientCommand = z.infer<typeof clientCommandSchema>;

/** 봉투. id는 클라이언트가 붙이는 요청 번호로, 오류 응답에 그대로 돌려준다. */
export const clientEnvelopeSchema = z.object({
  id: z.string().max(64).optional(),
  command: clientCommandSchema,
});

export type ClientEnvelope = { id?: string; command: ClientCommand };

/** 접속 직후 한 번 보내는 메시지. lastSeq가 있으면 끊긴 구간만 받는다. */
export const joinSchema = z.object({
  type: z.literal("join"),
  data: z.object({ lastSeq: z.number().int().min(0).optional() }).default({}),
});

// ── 서버 → 클라이언트 ─────────────────────────────────────

export type ErrorCode =
  | "bad_message"
  | "forbidden"
  | "not_found"
  | "stale"
  | "paused"
  | "idle"
  | "bad_roll"
  | "bad_sheet"
  | "rate_limited";

export type ServerEvent =
  | { type: "snapshot"; data: Snapshot }
  | { type: "object.added"; data: GameObject }
  | { type: "object.updated"; data: GameObject }
  | { type: "object.removed"; data: { id: string } }
  | { type: "settings.effects"; data: { effects: EffectSettings } }
  | { type: "settings.madness"; data: { entries: string[] } }
  | { type: "flow.updated"; data: { flow: Flow } }
  | { type: "audio.library"; data: { tracks: AudioTrack[] } }
  | { type: "audio.play"; data: { assetId: string; channel: AudioKind; volume: number; loop: boolean; fadeMs: number; startedAt: number } }
  | { type: "audio.stopped"; data: { fadeMs: number } }
  | { type: "audio.volume"; data: { volume: number } }
  | { type: "initiative.updated"; data: { initiative: Initiative | null } }
  | { type: "madness.result"; data: MadnessResult }
  | { type: "scene.added"; data: Scene }
  | { type: "scene.updated"; data: Scene }
  | { type: "scene.removed"; data: { id: string } }
  /** 활성 장면이 바뀜. KP가 아닌 사람에게는 새 장면에서 보이는 오브젝트 전체가 함께 간다. */
  | { type: "scene.activated"; data: { scene: Scene; transition: Transition; objects?: GameObject[] } }
  | { type: "handout.added"; data: Handout }
  | { type: "handout.updated"; data: Handout }
  | { type: "handout.removed"; data: { id: string } }
  | { type: "handout.shown"; data: { id: string } }
  | { type: "character.added"; data: Character }
  | { type: "character.updated"; data: Character }
  | { type: "character.removed"; data: { id: string } }
  | { type: "roll.result"; data: RollLogEntry }
  /** 다른 사람의 비밀 굴림. 결과는 담지 않는다. */
  | { type: "roll.hidden"; data: { id: string; userId: string; userName: string; at: number } }
  | { type: "presence"; data: { members: Member[] } }
  | { type: "session.started"; data: { number: number } }
  | { type: "session.paused"; data: { reason: "kp_disconnected" | "kp_request" } }
  | { type: "session.resumed"; data: Record<string, never> }
  | { type: "session.ended"; data: EndSummary };

/** seq가 붙은 이벤트. snapshot과 error는 seq가 없다. */
export type ServerMessage =
  | { seq: number; event: Exclude<ServerEvent, { type: "snapshot" }> }
  | { seq: 0; event: Extract<ServerEvent, { type: "snapshot" }> }
  | { seq: 0; event: { type: "error"; data: { code: ErrorCode; message: string; requestId?: string } } };
