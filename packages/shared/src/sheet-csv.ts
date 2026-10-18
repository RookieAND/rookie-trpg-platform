import { CSV_BOM, guardCell, parseCsv, serializeCsv, unguardCell } from "./csv";
import { deriveCharacter, CHARACTERISTIC_KEYS, DEFAULT_SKILLS, MAX_SKILLS, MAX_WEAPONS, SAN_CAP, LUCK_CAP, defaultSkillValues, type Character, type CharacteristicKey, type Weapon } from "./sheet";
import { characterInputSchema, weaponSchema, type CharacterData } from "./protocol";

/**
 * 캐릭터 시트 CSV. 사람이 손으로 쓴 시트도 읽을 수 있게 느슨하지만, 내보내는 모양은 늘 같다.
 *
 * 고정 배치(첫 칸이 구역 이름이면 그 아래 줄들이 그 구역이다. 빈 줄과 `#`로 시작하는 줄은 무시한다):
 *
 *   밤의 탁자 캐릭터 시트,1
 *   [기본 정보]        이름 / 나이 / 직업         (이름,값)
 *   [특성치]           STR CON SIZ DEX APP INT POW EDU   (이름,값)
 *   [파생 수치]        항목,현재,최대 → HP MP SAN 행운   (최대는 참고용이라 특성치로 다시 계산한다)
 *   [기능]             기능,값,성장                      (성장 칸에 O면 성장 표시)
 *   [무기]             이름,기능,피해
 *   [소지품]           칸마다 한 덩어리 글(줄바꿈은 따옴표 안에)
 *   [비고]             메모,글 / 인물 배경,글
 *
 * 쉼표로 나눈 파일도, 구글 시트에서 복사한 탭 글도 읽는다. 값 검사는 서버의 characterInputSchema를 그대로 쓴다.
 */

export const SHEET_CSV_TITLE = "밤의 탁자 캐릭터 시트";
export const SHEET_CSV_VERSION = 1;
/** 읽어 들일 글 길이의 상한(글자 수). 서버가 구글 시트에서 받는 상한(1MB)과 맞춘다. */
export const SHEET_CSV_MAX_CHARS = 1_000_000;

export const SECTION_BASIC = "기본 정보";
export const SECTION_STATS = "특성치";
export const SECTION_DERIVED = "파생 수치";
export const SECTION_SKILLS = "기능";
export const SECTION_WEAPONS = "무기";
export const SECTION_POSSESSIONS = "소지품";
export const SECTION_NOTES = "비고";
export const CSV_SECTIONS = [SECTION_BASIC, SECTION_STATS, SECTION_DERIVED, SECTION_SKILLS, SECTION_WEAPONS, SECTION_POSSESSIONS, SECTION_NOTES] as const;
type Section = (typeof CSV_SECTIONS)[number];

/** CSV로 내보낼 수 있는 캐릭터 모양. 보관함 캐릭터·입력값이 그대로 들어간다. */
export interface SheetCsvSource {
  name: string;
  age: number;
  occupation?: string;
  characteristics: Record<CharacteristicKey, number>;
  luck?: number;
  hp?: number;
  mp?: number;
  san?: number;
  skills?: ReadonlyArray<{ name: string; value: number; grown?: boolean }>;
  weapons?: ReadonlyArray<Weapon>;
  possessions?: string;
  notes?: string;
  backstory?: string;
}

/** 룸 안의 시트(기능이 이름표 형태)를 CSV 원본 모양으로 바꾼다. */
export function sheetCsvSourceFromCharacter(c: Character): SheetCsvSource {
  return {
    name: c.name,
    age: c.age,
    occupation: c.occupation,
    characteristics: c.characteristics,
    luck: c.luck,
    hp: c.hp,
    mp: c.mp,
    san: c.san,
    skills: Object.entries(c.skills).map(([name, s]) => ({ name, value: s.value, grown: s.grown })),
    weapons: c.weapons ?? [],
    possessions: c.possessions ?? "",
    notes: c.notes,
    backstory: c.backstory ?? "",
  };
}

const GROWN_MARK = "O";
const t = guardCell;

type Row = Array<string | number>;

function buildRows(src: SheetCsvSource, opts: { template: boolean }): Row[] {
  const blank = opts.template;
  const derived = deriveCharacter({ characteristics: src.characteristics, age: src.age });
  const rows: Row[] = [];
  if (blank) {
    rows.push(["# 이 양식은 '가져오기'로 읽혀요. [구역] 이름과 첫 칸의 항목 이름은 바꾸지 말아 주세요."]);
    rows.push(["# 이름·나이·특성치 8개는 꼭 채워야 해요. 파생 수치의 현재 칸을 비우면 최대로 시작해요."]);
    rows.push(["# '#'으로 시작하는 줄은 설명이라 무시돼요. 성장 칸에 O를 적으면 성장 표시가 돼요."]);
  }
  rows.push([SHEET_CSV_TITLE, SHEET_CSV_VERSION], []);

  rows.push([`[${SECTION_BASIC}]`], ["이름", blank ? "" : t(src.name)], ["나이", src.age], ["직업", t(src.occupation ?? "")], []);

  rows.push([`[${SECTION_STATS}]`]);
  for (const k of CHARACTERISTIC_KEYS) rows.push([k, src.characteristics[k]]);
  rows.push([]);

  const cur = (v: number | undefined, fallback: number) => (blank ? "" : (v ?? fallback));
  rows.push(
    [`[${SECTION_DERIVED}]`],
    ["항목", "현재", "최대"],
    ["HP", cur(src.hp, derived.limits.hp), derived.limits.hp],
    ["MP", cur(src.mp, derived.limits.mp), derived.limits.mp],
    ["SAN", cur(src.san, src.characteristics.POW), SAN_CAP],
    ["행운", blank ? "" : (src.luck ?? ""), LUCK_CAP],
    [],
  );

  rows.push([`[${SECTION_SKILLS}]`], ["기능", "값", "성장"]);
  for (const s of src.skills ?? []) rows.push([t(s.name), s.value, s.grown ? GROWN_MARK : ""]);
  rows.push([]);

  rows.push([`[${SECTION_WEAPONS}]`], ["이름", "기능", "피해"]);
  if (blank) rows.push(["# 예: 권총,사격(권총),1d10"]);
  for (const w of src.weapons ?? []) rows.push([t(w.name), t(w.skill), t(w.damage)]);
  rows.push([]);

  rows.push([`[${SECTION_POSSESSIONS}]`]);
  if (src.possessions) rows.push([t(src.possessions)]);
  rows.push([]);

  rows.push([`[${SECTION_NOTES}]`], ["메모", t(src.notes ?? "")], ["인물 배경", t(src.backstory ?? "")]);
  return rows;
}

/** 캐릭터를 CSV 글로 만든다. 기본은 엑셀이 한글을 깨뜨리지 않도록 맨 앞에 BOM을 붙인다. */
export function characterToCsv(src: SheetCsvSource, opts: { bom?: boolean } = {}): string {
  return (opts.bom === false ? "" : CSV_BOM) + serializeCsv(buildRows(src, { template: false }));
}

/** 가져오기 양식. 7판 기본 기능이 초기값으로 채워져 있고, 이름만 비어 있어 그대로는 가져와지지 않는다. */
export function sheetCsvTemplate(opts: { bom?: boolean } = {}): string {
  const characteristics = { STR: 50, CON: 50, SIZ: 50, DEX: 50, APP: 50, INT: 50, POW: 50, EDU: 50 };
  const skills = defaultSkillValues({ characteristics }).map((s) => ({ ...s, grown: false }));
  const src: SheetCsvSource = { name: "", age: 25, occupation: "", characteristics, skills, weapons: [], possessions: "", notes: "", backstory: "" };
  return (opts.bom === false ? "" : CSV_BOM) + serializeCsv(buildRows(src, { template: true }));
}

// ── 읽기 ──────────────────────────────────────────────────

export interface SheetCsvIssue {
  /** 1부터 세는 CSV 행 번호(칸 안 줄바꿈은 한 행으로 센다). 행과 무관하면 없다. */
  row?: number;
  message: string;
}

export interface SheetCsvResult {
  /** 오류가 없으면 서버가 받아 주는 모양의 캐릭터 */
  data?: CharacterData;
  /** 이게 하나라도 있으면 가져올 수 없다 */
  errors: SheetCsvIssue[];
  /** 건너뛴 행과 고쳐 읽은 값 */
  warnings: SheetCsvIssue[];
  /** 알아 두면 좋은 점(목록에 없는 기능 이름, 다시 계산한 최대값 등). 가져오기는 그대로 된다. */
  notes: SheetCsvIssue[];
  /** 건너뛴 행 수 */
  skippedRows: number;
}

const compact = (s: string) => s.replace(/\s+/g, "").toLowerCase();

const BASIC_KEYS: Record<string, "name" | "age" | "occupation"> = {
  이름: "name", name: "name", 캐릭터이름: "name", 성명: "name",
  나이: "age", age: "age",
  직업: "occupation", occupation: "occupation", job: "occupation",
};
const STAT_KEYS: Record<string, CharacteristicKey> = {
  str: "STR", 근력: "STR", con: "CON", 건강: "CON", siz: "SIZ", 크기: "SIZ", dex: "DEX", 민첩: "DEX",
  app: "APP", 외모: "APP", int: "INT", 지능: "INT", pow: "POW", 정신력: "POW", edu: "EDU", 교육: "EDU",
};
type DerivedKey = "hp" | "mp" | "san" | "luck";
const DERIVED_KEYS: Record<string, DerivedKey> = {
  hp: "hp", 체력: "hp", mp: "mp", 마력: "mp", san: "san", sanity: "san", 이성: "san", 행운: "luck", luck: "luck", 운: "luck",
};
const DERIVED_LABEL: Record<DerivedKey, string> = { hp: "HP", mp: "MP", san: "SAN", luck: "행운" };
const NOTE_KEYS: Record<string, "notes" | "backstory"> = { 메모: "notes", 비고: "notes", note: "notes", notes: "notes", 인물배경: "backstory", 배경: "backstory", backstory: "backstory" };

const TRUE_MARKS = new Set(["o", "y", "yes", "true", "t", "1", "v", "✓", "✔", "☑", "예", "성장", "체크", "○", "ㅇ"]);
const FALSE_MARKS = new Set(["", "x", "n", "no", "false", "f", "0", "✗", "✘", "☐", "아니오", "×"]);

const TEXT_LIMITS = { possessions: 1000, notes: 2000, backstory: 2000 } as const;
const SKILL_NAME_MAX = 30;

/** 목록에 있는 기능 이름이거나, `외국어(영어)`처럼 목록 이름 뒤에 괄호로 분야를 적은 이름인가 */
const KNOWN_SKILL_BASES = new Set<string>([...DEFAULT_SKILLS.map((s) => s.name), "회피", "모국어", "격투", "언어", "예술", "공예"]);
export function isKnownSkillName(name: string): boolean {
  if (KNOWN_SKILL_BASES.has(name)) return true;
  const m = /^(.+?)\s*\(.*\)$/.exec(name);
  return !!m && KNOWN_SKILL_BASES.has(m[1]!.trim());
}

const parseIntCell = (raw: string): number | null => {
  const s = raw.trim().replace(/^\+/, "");
  const m = /^(\d{1,6})(?:\.0+)?$/.exec(s);
  return m ? Number(m[1]) : null;
};

const cleanText = (raw: string) => unguardCell(raw).replace(/\r\n?/g, "\n");
const cleanKey = (raw: string) => unguardCell(raw).trim();

function sectionOf(cells: string[], allowBare: boolean): Section | "unknown" | null {
  const first = (cells[0] ?? "").trim();
  const m = /^[[［【](.+?)[\]］】]$/.exec(first);
  if (m) {
    const name = m[1]!.trim();
    return (CSV_SECTIONS as readonly string[]).includes(name) ? (name as Section) : "unknown";
  }
  if (allowBare && (CSV_SECTIONS as readonly string[]).includes(first) && cells.slice(1).every((c) => c.trim() === "")) return first as Section;
  return null;
}

/**
 * CSV 글을 읽어 캐릭터로 만든다. 한 줄이 잘못돼도 나머지는 읽고, 건너뛴 줄은 warnings에 모은다.
 * 이름·나이·특성치처럼 없으면 캐릭터가 안 되는 값이 틀렸을 때만 errors가 생기고 data는 없다.
 */
export function parseSheetCsv(text: string): SheetCsvResult {
  const errors: SheetCsvIssue[] = [];
  const warnings: SheetCsvIssue[] = [];
  const notes: SheetCsvIssue[] = [];
  const err = (message: string, row?: number) => void errors.push(row === undefined ? { message } : { row, message });
  const warn = (message: string, row?: number) => void warnings.push(row === undefined ? { message } : { row, message });
  const note = (message: string, row?: number) => void notes.push(row === undefined ? { message } : { row, message });
  const skipped = () => warnings.filter((w) => w.row !== undefined).length;
  const fail = (): SheetCsvResult => ({ errors, warnings, notes, skippedRows: skipped() });
  /** 값이 있었지만 틀려서 오류로 알린 항목(없다고 또 알리지 않으려고 기억한다) */
  const bad = new Set<string>();

  if (text.length > SHEET_CSV_MAX_CHARS) {
    err("내용이 너무 길어요. 1MB 안쪽의 시트만 가져올 수 있어요.");
    return fail();
  }
  const { rows, unterminatedQuote } = parseCsv(text);
  if (unterminatedQuote) note("따옴표(\")가 닫히지 않았어요. 마지막 칸이 잘못 읽혔을 수 있어요.");

  let section: Section | "unknown" | null = null;
  let sawSection = false;
  let titleSeen = false;
  const basic: { name?: string; age?: number; occupation?: string } = {};
  const seenBasic = new Set<string>();
  const stats: Partial<Record<CharacteristicKey, number>> = {};
  const derivedCur: Partial<Record<DerivedKey, number>> = {};
  const derivedMax: Partial<Record<DerivedKey, number>> = {};
  const seenDerived = new Set<string>();
  const skills: Array<{ name: string; value: number; grown: boolean }> = [];
  const skillNames = new Set<string>();
  const weapons: Weapon[] = [];
  const possessionRows: string[] = [];
  const noteFields: { notes?: string; backstory?: string } = {};
  let skillOverflow = 0;
  let weaponOverflow = 0;

  rows.forEach((cells, idx) => {
    const row = idx + 1;
    const first = (cells[0] ?? "").trim();
    if (cells.every((c) => c.trim() === "")) return;
    if (first.startsWith("#")) return;
    if (!titleSeen && !sawSection && first === SHEET_CSV_TITLE) {
      titleSeen = true;
      const v = parseIntCell(cells[1] ?? "");
      if (v !== null && v > SHEET_CSV_VERSION) note(`더 새로운 양식(버전 ${v})이에요. 읽을 수 있는 것만 가져와요.`, row);
      return;
    }
    const sec = sectionOf(cells, section !== SECTION_POSSESSIONS && section !== SECTION_NOTES);
    if (sec) {
      sawSection = true;
      section = sec;
      if (sec === "unknown") warn(`알 수 없는 구역 '${first}'이라 그 아래 줄을 건너뛰어요.`, row);
      return;
    }
    if (section === null) return void warn("구역 이름([기본 정보] 등) 앞에 있는 줄이라 건너뛰었어요.", row);
    if (section === "unknown") return void warn("알 수 없는 구역 안의 줄이라 건너뛰었어요.", row);

    const key = cleanKey(cells[0] ?? "");
    const k = compact(key);
    const arg = (i: number) => cleanText(cells[i] ?? "").trim();

    switch (section) {
      case SECTION_BASIC: {
        const field = BASIC_KEYS[k];
        if (!field) return void warn(`기본 정보에 '${key}' 항목은 없어서 건너뛰었어요.`, row);
        if (seenBasic.has(field)) return void warn(`'${key}'이(가) 두 번 나와서 뒤의 것을 건너뛰었어요.`, row);
        seenBasic.add(field);
        const v = arg(1);
        if (field === "age") {
          const n = parseIntCell(v);
          if (n === null || n < 15 || n > 90) (bad.add("age"), err(`나이는 15~90 사이 정수여야 해요. ('${v}')`, row));
          else basic.age = n;
        } else if (v.length > 40) (bad.add(field), err(`${field === "name" ? "이름" : "직업"}은 40자까지예요.`, row));
        else basic[field] = v;
        return;
      }
      case SECTION_STATS: {
        const stat = STAT_KEYS[k];
        if (!stat) return void warn(`'${key}'은(는) 특성치 이름이 아니라서 건너뛰었어요.`, row);
        if (stat in stats) return void warn(`${stat}이(가) 두 번 나와서 뒤의 것을 건너뛰었어요.`, row);
        const n = parseIntCell(arg(1));
        if (n === null || n < 1 || n > 99) return void (bad.add(stat), err(`${stat}은(는) 1~99 사이 정수여야 해요. ('${arg(1)}')`, row));
        stats[stat] = n;
        return;
      }
      case SECTION_DERIVED: {
        if (k === "항목") return;
        const d = DERIVED_KEYS[k];
        if (!d) return void warn(`파생 수치에 '${key}' 항목은 없어서 건너뛰었어요.`, row);
        if (seenDerived.has(d)) return void warn(`${DERIVED_LABEL[d]}이(가) 두 번 나와서 뒤의 것을 건너뛰었어요.`, row);
        seenDerived.add(d);
        const cur = arg(1);
        if (cur !== "") {
          const n = parseIntCell(cur);
          if (n === null || n > 99) warn(`${DERIVED_LABEL[d]} 현재값은 0~99 정수여야 해서 건너뛰었어요. ('${cur}')`, row);
          else derivedCur[d] = n;
        }
        const max = parseIntCell(arg(2));
        if (max !== null) derivedMax[d] = max;
        return;
      }
      case SECTION_SKILLS: {
        const second = arg(1);
        if (["기능", "이름", "기능이름", "스킬", "skill", "name"].includes(k) && parseIntCell(second) === null) return; // 머리글 줄
        if (key === "") return void warn("기능 이름이 비어 있어 건너뛰었어요.", row);
        if (key.length > SKILL_NAME_MAX) return void warn(`기능 이름 '${key.slice(0, 12)}…'이(가) ${SKILL_NAME_MAX}자를 넘어 건너뛰었어요.`, row);
        const value = parseIntCell(second);
        if (value === null || value > 100) return void warn(`'${key}'의 값은 0~100 사이 정수여야 해서 건너뛰었어요. ('${second}')`, row);
        if (skillNames.has(key)) return void warn(`기능 '${key}'이(가) 두 번 나와서 뒤의 것을 건너뛰었어요.`, row);
        if (skills.length >= MAX_SKILLS) {
          skillOverflow++;
          return void warn(`기능은 ${MAX_SKILLS}개까지라서 '${key}'을(를) 건너뛰었어요.`, row);
        }
        const mark = arg(2).toLowerCase();
        let grown = false;
        if (TRUE_MARKS.has(mark)) grown = true;
        else if (!FALSE_MARKS.has(mark)) note(`'${key}'의 성장 칸 '${arg(2)}'을(를) 알아보지 못해 체크하지 않았어요. 성장은 O로 적어요.`, row);
        skillNames.add(key);
        skills.push({ name: key, value, grown });
        if (!isKnownSkillName(key)) note(`'${key}'은(는) 기본 기능 목록에 없는 이름이에요. 그대로 가져와요.`, row);
        return;
      }
      case SECTION_WEAPONS: {
        if (["이름", "무기", "무기이름", "name"].includes(k) && ["기능", "공격기능", "skill"].includes(compact(arg(1)))) return; // 머리글 줄
        if (weapons.length >= MAX_WEAPONS) {
          weaponOverflow++;
          return void warn(`무기는 ${MAX_WEAPONS}개까지라서 '${key}'을(를) 건너뛰었어요.`, row);
        }
        const parsed = weaponSchema.safeParse({ name: key, skill: arg(1), damage: arg(2) });
        if (!parsed.success) {
          const first = parsed.error.issues[0];
          const field = first?.path[0];
          const why =
            field === "damage" && arg(2) !== "" && arg(2).length <= 20
              ? "피해는 1d6+db처럼 주사위 식으로 적어 주세요."
              : `${field === "name" ? "이름" : field === "skill" ? "공격 기능" : "피해"}이(가) 비었거나 너무 길어요.`;
          return void warn(`무기 '${key || "(이름 없음)"}'을(를) 건너뛰었어요. ${why}`, row);
        }
        weapons.push(parsed.data);
        return;
      }
      case SECTION_POSSESSIONS: {
        const parts = cells.map(cleanText).filter((c) => c.trim() !== "");
        possessionRows.push(parts.join(", "));
        return;
      }
      case SECTION_NOTES: {
        const field = NOTE_KEYS[k];
        if (!field) return void warn(`비고에 '${key}' 항목은 없어서 건너뛰었어요. (메모, 인물 배경)`, row);
        if (field in noteFields) return void warn(`'${key}'이(가) 두 번 나와서 뒤의 것을 건너뛰었어요.`, row);
        noteFields[field] = cleanText(cells[1] ?? "");
        return;
      }
    }
  });

  if (!sawSection) {
    err("가져올 수 있는 구역을 찾지 못했어요. '양식 받기'로 받은 파일과 같은 모양인지 확인해 주세요.");
    return fail();
  }
  if (skillOverflow > 0) note(`기능이 ${MAX_SKILLS}개를 넘어 ${skillOverflow}개를 못 가져왔어요.`);
  if (weaponOverflow > 0) note(`무기가 ${MAX_WEAPONS}개를 넘어 ${weaponOverflow}개를 못 가져왔어요.`);

  if (!basic.name && !bad.has("name")) err("이름이 없어요. [기본 정보]의 '이름' 칸을 채워 주세요.");
  if (basic.age === undefined && !bad.has("age")) err("나이가 없어요. [기본 정보]의 '나이' 칸을 채워 주세요.");
  const missing = CHARACTERISTIC_KEYS.filter((s) => stats[s] === undefined && !bad.has(s));
  if (missing.length > 0) err(`특성치가 빠졌어요: ${missing.join(", ")}`);
  if (errors.length > 0) return fail();

  const characteristics = stats as Record<CharacteristicKey, number>;
  const limits = deriveCharacter({ characteristics, age: basic.age! }).limits;
  const expectedMax: Record<DerivedKey, number> = { hp: limits.hp, mp: limits.mp, san: SAN_CAP, luck: LUCK_CAP };
  for (const d of ["hp", "mp", "san", "luck"] as const) {
    const given = derivedMax[d];
    if (given !== undefined && given !== expectedMax[d]) note(`${DERIVED_LABEL[d]} 최대 ${given}은(는) 특성치로 다시 계산해요. (지금 ${expectedMax[d]})`);
    const cur = derivedCur[d];
    if (cur !== undefined && cur > expectedMax[d]) {
      derivedCur[d] = expectedMax[d];
      warn(`${DERIVED_LABEL[d]} 현재값 ${cur}이(가) 최대 ${expectedMax[d]}보다 커서 최대로 맞췄어요.`);
    }
  }
  if (derivedCur.luck === undefined) note("행운 현재값이 없어 0으로 들어가요. 가져온 뒤 고쳐 주세요.");

  const clip = (field: keyof typeof TEXT_LIMITS, value: string): string => {
    if (value.length <= TEXT_LIMITS[field]) return value;
    const label = field === "possessions" ? "소지품" : field === "notes" ? "메모" : "인물 배경";
    warn(`${label}이(가) ${TEXT_LIMITS[field]}자를 넘어 그만큼만 가져왔어요.`);
    return value.slice(0, TEXT_LIMITS[field]);
  };

  const candidate = {
    name: basic.name!,
    age: basic.age!,
    occupation: basic.occupation ?? "",
    characteristics,
    ...(derivedCur.luck !== undefined ? { luck: derivedCur.luck } : {}),
    ...(derivedCur.hp !== undefined ? { hp: derivedCur.hp } : {}),
    ...(derivedCur.mp !== undefined ? { mp: derivedCur.mp } : {}),
    ...(derivedCur.san !== undefined ? { san: derivedCur.san } : {}),
    skills,
    notes: clip("notes", noteFields.notes ?? ""),
    backstory: clip("backstory", noteFields.backstory ?? ""),
    possessions: clip("possessions", possessionRows.join("\n")),
    weapons,
  };

  // 마지막 관문: 서버가 쓰는 스키마로 한 번 더 확인한다.
  const checked = characterInputSchema.safeParse(candidate);
  if (!checked.success) {
    for (const issue of checked.error.issues.slice(0, 5)) err(`${issue.path.join(".") || "시트"}: ${issue.message}`);
    return fail();
  }
  return { data: checked.data, errors, warnings, notes, skippedRows: skipped() };
}
