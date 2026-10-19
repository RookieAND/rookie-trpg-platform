import { z } from "zod";
import { MAX_SUM_EXPR_LENGTH } from "./dice";
import { isDamageExpr, AUDIO_KINDS, BEAT_KINDS, BGM_STOP, EFFECT_LEVELS, FOG_MAX_RADIUS, MAX_AUDIO_TRACKS, MAX_BEATS, MAX_BEAT_HANDOUTS, MAX_BRANCHES, MAX_CHARACTERS, MAX_FOG_ZONES, MAX_HANDOUTS, MAX_MADNESS_ENTRIES, MAX_OBJECTS, MAX_SCENES } from "./protocol";
import { MARKER_TEXT_MAX, MAX_MARKERS } from "./markers";
import { safeKey } from "./safe-key";
import { CHARACTERISTIC_KEYS, MAX_SKILLS, MAX_WEAPONS } from "./sheet";

/**
 * 시나리오·백업 파일(JSON)의 형식, 검사, 요약. CLI(pnpm import:scenario), 웹의 "시나리오 가져오기",
 * 로비의 "백업에서 새 룸 만들기"가 모두 이 파서를 쓴다. 형식 설명은 docs/scenario-format.md.
 *
 * 두 가지 파일이 같은 모양을 쓴다.
 *  - 시나리오(roll-and-call-scenario, 버전 1~3): 사람이 쓰는 파일. 버전 2·3은 앞 버전에 선택 필드만 더했다(3: 토큰 표식).
 *  - 백업(roll-and-call-backup, 버전 1·2; 2는 토큰 표식을 담는다): 룸에서 내보낸 파일. 시나리오에 설정·이미지(media)가 더해진다.
 * 파일 안의 id는 룸에 저장되지 않는 이름표(key)이고, 가져올 때 서버가 모두 새 id로 바꾼다.
 */

export const SCENARIO_FORMAT = "roll-and-call-scenario";
export const BACKUP_FORMAT = "roll-and-call-backup";
export const SCENARIO_VERSION = 3;
export const BACKUP_VERSION = 2;

export const MADNESS_ENTRY_MAX_LENGTH = 120;
export const AUDIO_LABEL_MAX_LENGTH = 40;
/** 파일 하나가 품을 수 있는 이미지·음원(데이터 주소) 수와 크기 합 */
export const MAX_EMBEDDED_FILES = 80;
/** 한 파일에 품을 수 있는 이미지·음원 데이터의 합(서버의 가져오기 본문 한도 12MB 안에 들어와야 한다) */
export const MAX_EMBEDDED_BYTES = 9 * 1024 * 1024;

const KEY = /^[A-Za-z0-9_-]{1,40}$/;
const IMAGE_ID = /^[a-f0-9]{32}$/;

// ── 이미지·음원 참조 ─────────────────────────────────────

/**
 * 이미지·음원을 가리키는 글. 세 가지 중 하나다.
 *  - 올려 둔 파일의 id(32자리 16진수)
 *  - 데이터 주소(`data:image/png;base64,...`): 서버가 크기·형식을 확인해 새로 저장한다
 *  - 파일 경로: CLI에서만 쓴다(웹에서는 건너뛰어요)
 */
export type MediaRef = { kind: "id"; id: string } | { kind: "data"; base64: string } | { kind: "file"; path: string };

export function classifyRef(ref: string): MediaRef {
  if (IMAGE_ID.test(ref)) return { kind: "id", id: ref };
  const m = /^data:[^;,]*;base64,([\s\S]*)$/i.exec(ref);
  if (m) return { kind: "data", base64: m[1]! };
  return { kind: "file", path: ref };
}

/** 데이터 주소의 대략적인 바이트 수(디코딩하지 않고 센다) */
export const dataRefBytes = (ref: string): number => {
  const r = classifyRef(ref);
  return r.kind === "data" ? Math.floor((r.base64.length * 3) / 4) : 0;
};

const mediaRef = z.string().min(1).max(14_500_000);

// ── 스키마 ──────────────────────────────────────────────

const coord = z.number().finite().min(-100_000).max(100_000);
const keyField = z.string().regex(KEY, "key는 영문·숫자·-·_ 40자 이내여야 해요.");
const name40 = z.string().trim().min(1).max(40);

const skill = z.object({ name: safeKey(z.string().trim().min(1).max(30)), value: z.number().int().min(0).max(100), grown: z.boolean().optional() });
const weapon = z.object({
  name: z.string().trim().min(1).max(30),
  skill: z.string().trim().min(1).max(30),
  damage: z.string().trim().min(1).max(40).refine(isDamageExpr, { message: "피해는 1d6+db처럼 주사위 식으로 적어 주세요." }),
});

const sceneSchema = z.object({
  key: keyField,
  name: name40,
  start: z.boolean().optional(),
  /** 장면에 들어갈 때 틀 배경음의 audio key. "__stop__"이면 음악을 멈춘다. */
  bgm: z.string().min(1).max(40).optional(),
  background: mediaRef.optional(),
  fog: z
    .object({
      enabled: z.boolean().default(true),
      zones: z.array(z.object({ x: coord, y: coord, r: z.number().int().min(10).max(FOG_MAX_RADIUS) })).max(MAX_FOG_ZONES).default([]),
    })
    .optional(),
});

const tokenSchema = z.object({
  scene: z.string().min(1).max(40),
  kind: z.enum(["token", "prop"]),
  name: name40,
  x: coord,
  y: coord,
  layer: z.enum(["background", "object", "gm"]).default("object"),
  visibleTo: z.enum(["all", "gm"]).default("all"),
  /** 소유한 PL: 룸의 PL 이름, 그 PL의 캐릭터 이름, 또는 PL1·PL2 같은 순번. 비우면 소유자 없음(NPC) */
  owner: z.string().trim().min(1).max(40).optional(),
  image: mediaRef.optional(),
  vision: z.number().int().min(0).max(FOG_MAX_RADIUS).optional(),
  /** 이어 둘 캐릭터 시트(characters의 key) */
  character: z.string().min(1).max(40).optional(),
  /** PL에게도 HP 막대를 보여 줄지 */
  hpPublic: z.boolean().optional(),
  locked: z.boolean().optional(),
  /** 상태 표식(기절·중독 등). key는 모르는 값이어도 모양만 맞으면 읽는다(새 버전의 파일). 토큰에만 쓴다. */
  markers: z
    .array(z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,19}$/), secret: z.boolean().optional(), text: z.string().trim().max(MARKER_TEXT_MAX).optional() }))
    .max(MAX_MARKERS)
    .optional(),
});

const characterSchema = z.object({
  key: keyField.optional(),
  name: z.string().trim().min(1).max(40),
  age: z.number().int().min(15).max(90),
  occupation: z.string().max(40).default(""),
  characteristics: z.object(Object.fromEntries(CHARACTERISTIC_KEYS.map((k) => [k, z.number().int().min(1).max(99)])) as Record<(typeof CHARACTERISTIC_KEYS)[number], z.ZodNumber>),
  luck: z.number().int().min(0).max(99).optional(),
  hp: z.number().int().min(0).max(99).optional(),
  mp: z.number().int().min(0).max(99).optional(),
  san: z.number().int().min(0).max(99).optional(),
  skills: z.array(skill).max(MAX_SKILLS).default([]),
  weapons: z.array(weapon).max(MAX_WEAPONS).default([]),
  notes: z.string().max(2000).default(""),
  backstory: z.string().max(2000).default(""),
  possessions: z.string().max(1000).default(""),
  /** 백업에서 PL의 캐릭터였던 시트(가져오면 GM 몫으로 들어와요) */
  pc: z.boolean().optional(),
});

const handoutSchema = z.object({
  key: keyField,
  title: z.string().trim().min(1).max(70),
  body: z.string().max(4000).default(""),
  /** 생략하면 GM 전용 초안 */
  visibleTo: z.enum(["all", "gm"]).default("gm"),
  /** 보여 줄 PL: 룸의 PL 이름, 캐릭터 이름, 또는 PL1·PL2 같은 순번. 있으면 visibleTo보다 우선한다. */
  to: z.array(z.string().trim().min(1).max(40)).max(32).optional(),
  image: mediaRef.optional(),
  kpOnly: z.boolean().optional(),
});

const beatSchema = z.object({
  key: keyField,
  name: name40,
  kind: z.enum(BEAT_KINDS),
  scene: z.string().min(1).max(40).optional(),
  handouts: z.array(z.string().min(1).max(40)).max(MAX_BEAT_HANDOUTS).default([]),
  memo: z.string().max(1000).default(""),
  sanReward: z.string().trim().max(MAX_SUM_EXPR_LENGTH).optional(),
  bgm: z.string().min(1).max(40).optional(),
});

const conditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("manual") }),
  z.object({ type: z.literal("roll"), skill: z.string().trim().min(1).max(30), atLeast: z.enum(["regular", "hard", "extreme", "critical"]) }),
  z.object({ type: z.literal("stat"), stat: z.enum(["hp", "san", "luck"]), atMost: z.number().int().min(0).max(999) }),
  z.object({ type: z.literal("handout"), handout: z.string().min(1).max(40) }),
]);

const branchSchema = z.object({
  from: z.string().min(1).max(40),
  to: z.string().min(1).max(40),
  label: z.string().trim().min(1).max(40),
  condition: conditionSchema.optional(),
});

const audioSchema = z.object({
  key: keyField,
  label: z.string().trim().min(1).max(AUDIO_LABEL_MAX_LENGTH),
  kind: z.enum(AUDIO_KINDS),
  /** CLI 전용: 시나리오 JSON이 있는 폴더 기준 상대 경로 */
  file: z.string().min(1).max(300).optional(),
  /** 올려 둔 오디오 파일의 id */
  assetId: z.string().regex(IMAGE_ID, "assetId는 올려 둔 파일의 id(32자리)여야 해요.").optional(),
  /** 오디오 데이터 주소 */
  data: mediaRef.optional(),
  volume: z.number().int().min(0).max(100).optional(),
});

const effectLevel = z.object({ enabled: z.boolean(), intensity: z.union([z.literal(1), z.literal(2), z.literal(3)]) });

const docSchema = z.object({
  format: z.enum([SCENARIO_FORMAT, BACKUP_FORMAT]),
  version: z.number().int().min(1),
  roomName: z.string().trim().min(1).max(60),
  exportedAt: z.string().max(40).optional(),
  scenes: z.array(sceneSchema).min(1).max(MAX_SCENES),
  tokens: z.array(tokenSchema).max(MAX_OBJECTS).default([]),
  characters: z.array(characterSchema).max(MAX_CHARACTERS).default([]),
  handouts: z.array(handoutSchema).max(MAX_HANDOUTS).default([]),
  beats: z.array(beatSchema).max(MAX_BEATS).default([]),
  branches: z.array(branchSchema).max(MAX_BRANCHES).default([]),
  madnessTable: z.array(z.string()).optional(),
  audio: z.array(audioSchema).max(MAX_AUDIO_TRACKS).optional(),
  /** 룸 설정(백업). 새 룸에만 적용해요. */
  effects: z.object(Object.fromEntries(EFFECT_LEVELS.map((l) => [l, effectLevel])) as Record<(typeof EFFECT_LEVELS)[number], typeof effectLevel>).optional(),
  /** 백업에 품은 이미지: id → 데이터 주소. 이미지 참조가 이 id를 가리키면 이 파일을 쓴다. */
  media: z.record(z.string().regex(IMAGE_ID), mediaRef).optional(),
});

export type ScenarioDoc = z.infer<typeof docSchema>;
export type ScenarioScene = ScenarioDoc["scenes"][number];
export type ScenarioToken = ScenarioDoc["tokens"][number];
export type ScenarioCharacter = ScenarioDoc["characters"][number];
export type ScenarioHandout = ScenarioDoc["handouts"][number];
export type ScenarioBeat = ScenarioDoc["beats"][number];
export type ScenarioBranch = ScenarioDoc["branches"][number];
export type ScenarioAudio = NonNullable<ScenarioDoc["audio"]>[number];

// ── 제목 머리말 ──────────────────────────────────────────

/**
 * 가져오기 파일에서 제목이 `[KP]`(또는 `[GM]`)로 시작하면 GM 전용 노트다.
 * 표시용 제목에서는 이 머리말을 떼어 사용자 화면에 보이지 않게 한다.
 */
export function splitNoteTitle(title: string): { title: string; kpOnly: boolean } {
  const m = /^\[(?:KP|GM)\]\s*/i.exec(title);
  if (!m) return { title, kpOnly: false };
  return { title: title.slice(m[0].length).trim() || title, kpOnly: true };
}

// ── 오류 문장 ───────────────────────────────────────────

export interface ScenarioIssue {
  /** 사람이 찾기 쉬운 위치: `tokens[2] (낡은 상자) · x` */
  where: string;
  message: string;
}

const TYPE_KO: Record<string, string> = { string: "글자", number: "숫자", integer: "정수", boolean: "true 또는 false", array: "목록", object: "항목" };

function issueText(i: z.ZodIssue): string {
  if (/[가-힣]/.test(i.message)) return i.message;
  switch (i.code) {
    case "invalid_type":
      if (i.received === "undefined") return "빠졌어요.";
      return `${TYPE_KO[i.expected] ?? i.expected} 값이어야 해요.`;
    case "too_small": {
      if (i.type === "string") return i.minimum === 1 ? "비어 있어요." : `${i.minimum}자 이상이어야 해요.`;
      if (i.type === "array") return i.minimum === 1 ? "하나 이상 있어야 해요." : `${i.minimum}개 이상이어야 해요.`;
      return `${i.minimum} 이상이어야 해요.`;
    }
    case "too_big": {
      if (i.type === "string") return `${i.maximum}자까지예요.`;
      if (i.type === "array") return `${i.maximum}개까지예요.`;
      return `${i.maximum} 이하여야 해요.`;
    }
    case "invalid_enum_value":
      return `${i.options.map((o) => `"${String(o)}"`).join(", ")} 중 하나여야 해요.`;
    case "invalid_literal":
      return `"${String(i.expected)}"여야 해요.`;
    case "invalid_union":
    case "invalid_union_discriminator":
      return "형식이 맞지 않아요.";
    case "invalid_string":
      return "형식이 맞지 않아요.";
    default:
      return "값이 올바르지 않아요.";
  }
}

/** 오류 경로를 사람 말로: 배열 칸에는 그 항목의 이름을 붙여 준다. */
function whereText(raw: unknown, path: ReadonlyArray<string | number>): string {
  let cur: unknown = raw;
  let out = "";
  let labeled = false;
  for (const p of path) {
    if (typeof p === "number") {
      out += `[${p}]`;
      cur = Array.isArray(cur) ? cur[p] : undefined;
      const o = cur && typeof cur === "object" ? (cur as Record<string, unknown>) : undefined;
      const label = o ? (o.name ?? o.title ?? o.label ?? o.key) : undefined;
      labeled = typeof label === "string" && label !== "";
      if (labeled) out += ` (${String(label).slice(0, 20)})`;
    } else {
      out += out === "" ? p : labeled ? ` · ${p}` : `.${p}`;
      labeled = false;
      cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[p] : undefined;
    }
  }
  return out || "파일";
}

// ── 파싱 ────────────────────────────────────────────────

export type ScenarioParseResult = { ok: true; doc: ScenarioDoc; warnings: string[] } | { ok: false; errors: ScenarioIssue[] };

/** 글(JSON)을 읽어 검사한다. 맨 앞의 BOM은 무시한다. */
export function parseScenarioText(text: string): ScenarioParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ""));
  } catch (e) {
    const detail = e instanceof SyntaxError ? ` (${e.message.slice(0, 80)})` : "";
    return { ok: false, errors: [{ where: "파일", message: `JSON으로 읽을 수 없어요.${detail}` }] };
  }
  return parseScenario(raw);
}

export function parseScenario(raw: unknown): ScenarioParseResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: [{ where: "파일", message: "시나리오 파일이 아니에요. 맨 바깥이 { } 항목이어야 해요." }] };
  const head = raw as { format?: unknown; version?: unknown };
  if (head.format !== SCENARIO_FORMAT && head.format !== BACKUP_FORMAT) {
    return { ok: false, errors: [{ where: "format", message: `"${SCENARIO_FORMAT}"(시나리오) 또는 "${BACKUP_FORMAT}"(백업)이어야 해요.` }] };
  }
  const maxVersion = head.format === BACKUP_FORMAT ? BACKUP_VERSION : SCENARIO_VERSION;
  if (typeof head.version === "number" && head.version > maxVersion) {
    return { ok: false, errors: [{ where: "version", message: `더 새로운 버전(${head.version})의 파일이에요. 이 서비스는 ${maxVersion}까지 읽어요.` }] };
  }
  const parsed = docSchema.safeParse(raw);
  if (!parsed.success) {
    const errors = parsed.error.issues.slice(0, 60).map((i) => ({ where: whereText(raw, i.path), message: issueText(i) }));
    return { ok: false, errors };
  }
  const doc = parsed.data;
  const errors = checkDoc(doc);
  if (errors.length) return { ok: false, errors };
  return { ok: true, doc, warnings: [] };
}

/** 이름표(key) 참조와 서로 얽힌 규칙을 본다. 룸 상태와 상관없는 것만. */
export function checkDoc(doc: ScenarioDoc): ScenarioIssue[] {
  const errors: ScenarioIssue[] = [];
  const add = (where: string, message: string) => errors.push({ where, message });
  const dupes = <T extends { key?: string }>(list: T[], section: string) => {
    const seen = new Set<string>();
    list.forEach((x, i) => {
      if (x.key === undefined) return;
      if (seen.has(x.key)) add(`${section}[${i}] (${x.key})`, `key "${x.key}"가 겹쳐요.`);
      seen.add(x.key);
    });
  };
  dupes(doc.scenes, "scenes");
  dupes(doc.characters, "characters");
  dupes(doc.handouts, "handouts");
  dupes(doc.beats, "beats");
  dupes(doc.audio ?? [], "audio");

  if (doc.madnessTable !== undefined) {
    if (doc.madnessTable.length > MAX_MADNESS_ENTRIES) add("madnessTable", `${MAX_MADNESS_ENTRIES}줄까지예요(지금 ${doc.madnessTable.length}줄).`);
    doc.madnessTable.forEach((e, i) => {
      const t = e.trim();
      if (t.length === 0) add(`madnessTable[${i}]`, "비어 있어요.");
      else if (t.length > MADNESS_ENTRY_MAX_LENGTH) add(`madnessTable[${i}]`, `${MADNESS_ENTRY_MAX_LENGTH}자를 넘어요(지금 ${t.length}자).`);
    });
  }

  const sceneKeys = new Set(doc.scenes.map((s) => s.key));
  const charKeys = new Set(doc.characters.flatMap((c) => (c.key ? [c.key] : [])));
  const handoutByKey = new Map(doc.handouts.map((h) => [h.key, h]));
  const beatKeys = new Set(doc.beats.map((b) => b.key));
  const tracks = new Map((doc.audio ?? []).map((a) => [a.key, a]));
  (doc.audio ?? []).forEach((a, i) => {
    if (!a.file && !a.assetId && !a.data) add(`audio[${i}] (${a.key})`, "file, assetId, data 중 하나가 필요해요.");
  });

  const checkBgm = (where: string, k: string | undefined) => {
    if (k === undefined || k === BGM_STOP) return;
    const t = tracks.get(k);
    if (!t) add(where, `bgm "${k}"에 해당하는 audio가 없어요.`);
    else if (t.kind !== "bgm") add(where, `bgm "${k}"는 효과음(se)이라 배경음으로 쓸 수 없어요.`);
  };
  doc.scenes.forEach((s, i) => checkBgm(`scenes[${i}] (${s.name})`, s.bgm));
  doc.beats.forEach((b, i) => checkBgm(`beats[${i}] (${b.name})`, b.bgm));

  doc.tokens.forEach((t, i) => {
    const where = `tokens[${i}] (${t.name})`;
    if (!sceneKeys.has(t.scene)) add(where, `scene "${t.scene}"이 scenes에 없어요.`);
    if (t.character !== undefined && !charKeys.has(t.character)) add(where, `character "${t.character}"가 characters에 없어요. 시트에 key를 붙여 주세요.`);
  });
  doc.beats.forEach((b, i) => {
    const where = `beats[${i}] (${b.name})`;
    if (b.scene && !sceneKeys.has(b.scene)) add(where, `scene "${b.scene}"이 scenes에 없어요.`);
    for (const h of b.handouts) {
      const ho = handoutByKey.get(h);
      if (!ho) add(where, `handouts "${h}"가 handouts에 없어요.`);
      else if (ho.kpOnly || splitNoteTitle(ho.title).kpOnly) add(where, `GM 전용 노트("${h}")는 비트에 붙일 수 없어요.`);
    }
  });
  doc.branches.forEach((br, i) => {
    const where = `branches[${i}] (${br.label})`;
    if (!beatKeys.has(br.from)) add(where, `from "${br.from}"이 beats에 없어요.`);
    if (!beatKeys.has(br.to)) add(where, `to "${br.to}"이 beats에 없어요.`);
    if (br.from === br.to) add(where, "같은 비트로 되돌아가는 분기는 만들 수 없어요.");
    if (br.condition?.type === "handout") {
      const ho = handoutByKey.get(br.condition.handout);
      if (!ho) add(where, `condition.handout "${br.condition.handout}"가 handouts에 없어요.`);
      else if (ho.kpOnly || splitNoteTitle(ho.title).kpOnly) add(where, "GM 전용 노트는 분기 조건으로 쓸 수 없어요.");
    }
  });
  doc.handouts.forEach((h, i) => {
    const { title } = splitNoteTitle(h.title);
    if (title.length > 60) add(`handouts[${i}] (${h.title.slice(0, 20)})`, "제목은 60자까지예요.");
  });

  // 파일 하나에 품은 데이터(이미지·음원)의 수와 크기
  let files = 0;
  let bytes = 0;
  const count = (ref: string | undefined) => {
    if (ref && classifyRef(ref).kind === "data") {
      files += 1;
      bytes += dataRefBytes(ref);
    }
  };
  for (const s of doc.scenes) count(s.background);
  for (const t of doc.tokens) count(t.image);
  for (const h of doc.handouts) count(h.image);
  for (const a of doc.audio ?? []) count(a.data);
  for (const v of Object.values(doc.media ?? {})) count(v);
  if (files > MAX_EMBEDDED_FILES) add("파일", `품은 이미지·음원이 ${MAX_EMBEDDED_FILES}개를 넘어요(지금 ${files}개).`);
  if (bytes > MAX_EMBEDDED_BYTES) add("파일", `품은 이미지·음원이 너무 커요(최대 ${MAX_EMBEDDED_BYTES / 1024 / 1024}MB, 지금 ${(bytes / 1024 / 1024).toFixed(1)}MB).`);
  return errors;
}

// ── 요약 ────────────────────────────────────────────────

export interface ScenarioCounts {
  scenes: number;
  tokens: number;
  characters: number;
  handouts: number;
  beats: number;
  branches: number;
  audio: number;
  madness: number;
  images: number;
}

/** 미리보기에 보여 줄 개수 */
export function countScenario(doc: ScenarioDoc): ScenarioCounts {
  const refs = new Set<string>();
  const add = (r: string | undefined) => r && refs.add(r.length > 80 ? `${r.length}:${r.slice(0, 60)}${r.slice(-20)}` : r);
  for (const s of doc.scenes) add(s.background);
  for (const t of doc.tokens) add(t.image);
  for (const h of doc.handouts) add(h.image);
  return {
    scenes: doc.scenes.length,
    tokens: doc.tokens.length,
    characters: doc.characters.length,
    handouts: doc.handouts.length,
    beats: doc.beats.length,
    branches: doc.branches.length,
    audio: doc.audio?.length ?? 0,
    madness: doc.madnessTable?.length ?? 0,
    images: refs.size,
  };
}

/** "장면 2 · 토큰 3 · …" 한 줄 요약(0인 항목은 뺀다) */
export function countsLine(c: ScenarioCounts): string {
  const parts: Array<[string, number]> = [
    ["장면", c.scenes],
    ["토큰·소품", c.tokens],
    ["시트", c.characters],
    ["핸드아웃", c.handouts],
    ["비트", c.beats],
    ["분기", c.branches],
    ["음원", c.audio],
    ["이미지", c.images],
    ["광기표", c.madness],
  ];
  return parts.filter(([, n]) => n > 0).map(([l, n]) => `${l} ${n}`).join(" · ");
}

// ── 예시 ────────────────────────────────────────────────

/** 가로세로 8칸짜리 짙은 남색 PNG. 예시 파일의 장면 배경(데이터 주소 사용법을 보여 준다). */
const SAMPLE_BG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGOQUbHCihiGlgQA4+0egdUUGOYAAAAASUVORK5CYII=";

/** 문서(docs/scenario-format.md)의 예시와 "예시 받기" 파일이 같은 내용이다. */
export const SAMPLE_SCENARIO = {
  format: SCENARIO_FORMAT,
  version: SCENARIO_VERSION,
  roomName: "예시 시나리오",
  scenes: [
    { key: "hall", name: "현관", start: true, background: SAMPLE_BG, fog: { enabled: false, zones: [{ x: 500, y: 400, r: 160 }] } },
    { key: "cellar", name: "지하실", fog: { enabled: true, zones: [] } },
  ],
  tokens: [
    { scene: "hall", kind: "prop", name: "낡은 상자", x: 300, y: 200, layer: "object", visibleTo: "all" },
    { scene: "hall", kind: "token", name: "관리인", x: 600, y: 300, layer: "object", visibleTo: "all", character: "keeper", hpPublic: false },
    { scene: "hall", kind: "token", name: "첫 번째 PL", x: 500, y: 600, layer: "object", visibleTo: "all", owner: "PL1", vision: 120 },
    { scene: "cellar", kind: "prop", name: "금 간 거울", x: 200, y: 200, layer: "gm", visibleTo: "gm" },
  ],
  characters: [
    {
      key: "keeper",
      name: "관리인",
      age: 52,
      occupation: "관리인",
      characteristics: { STR: 50, CON: 55, SIZ: 60, DEX: 45, APP: 40, INT: 60, POW: 50, EDU: 55 },
      luck: 40,
      skills: [{ name: "듣기", value: 60 }, { name: "맨손 격투", value: 50 }],
      weapons: [{ name: "부지깽이", skill: "맨손 격투", damage: "1d6+db" }],
      notes: "수상한 열쇠를 갖고 있어요.",
    },
  ],
  handouts: [
    { key: "note", title: "찢어진 쪽지", body: "지하실 열쇠는 상자 안에.", visibleTo: "all" },
    { key: "letter", title: "첫 번째 PL에게 온 편지", body: "당신만 읽을 수 있는 편지예요.", to: ["PL1"] },
    { key: "secret", title: "[KP] 관리인의 비밀", body: "관리인은 사실...", visibleTo: "gm" },
  ],
  beats: [
    { key: "b1", name: "도착", kind: "start", scene: "hall", handouts: ["note"], memo: "분위기를 잡아요." },
    { key: "b2", name: "지하실", kind: "progress", scene: "cellar", handouts: [], memo: "", sanReward: "1d3" },
  ],
  branches: [{ from: "b1", to: "b2", label: "지하실로 내려가요" }],
  madnessTable: ["공포에 질려 도망쳐요", "아무 말도 못 하고 굳어요"],
} satisfies Record<string, unknown>;
