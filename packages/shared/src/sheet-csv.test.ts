import { describe, expect, it } from "vitest";
import { CSV_BOM, parseCsv } from "./csv";
import { characterInputSchema } from "./protocol";
import { CHARACTERISTIC_KEYS, defaultSkillValues, deriveCharacter, type Character } from "./sheet";
import { characterToCsv, isKnownSkillName, parseSheetCsv, sheetCsvSourceFromCharacter, sheetCsvTemplate, SHEET_CSV_MAX_CHARS, type SheetCsvSource } from "./sheet-csv";

const stats = { STR: 60, CON: 50, SIZ: 65, DEX: 70, APP: 55, INT: 80, POW: 45, EDU: 75 };

const sample = (): SheetCsvSource => ({
  name: "윤서하",
  age: 27,
  occupation: "기자, 프리랜서",
  characteristics: stats,
  luck: 55,
  hp: 9,
  mp: 7,
  san: 40,
  skills: [
    { name: "관찰력", value: 60, grown: true },
    { name: "외국어(영어)", value: 41, grown: false },
    { name: "도서관 이용", value: 20 },
  ],
  weapons: [{ name: "주먹", skill: "맨손 격투", damage: "1d3+db" }, { name: "권총, 낡은 것", skill: "사격(권총)", damage: "1d10" }],
  possessions: "손전등\n\"행운의\" 부적, 수첩",
  notes: "줄1\r\n줄2, 쉼표",
  backstory: "고향은 아캄.",
});

const ok = (text: string) => {
  const r = parseSheetCsv(text);
  expect(r.errors).toEqual([]);
  return r;
};

describe("내보내기", () => {
  it("UTF-8 BOM으로 시작하고 구역 순서가 고정이다", () => {
    const csv = characterToCsv(sample());
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const heads = parseCsv(csv).rows.map((r) => r[0]!).filter((c) => c.startsWith("["));
    expect(heads).toEqual(["[기본 정보]", "[특성치]", "[파생 수치]", "[기능]", "[무기]", "[소지품]", "[비고]"]);
    expect(characterToCsv(sample(), { bom: false }).startsWith(CSV_BOM)).toBe(false);
  });

  it("파생 수치에 HP·MP·SAN·행운의 현재와 최대가 들어간다", () => {
    const rows = parseCsv(characterToCsv(sample())).rows;
    const at = rows.findIndex((r) => r[0] === "[파생 수치]");
    const max = deriveCharacter({ characteristics: stats, age: 27 }).limits;
    expect(rows.slice(at + 1, at + 6)).toEqual([
      ["항목", "현재", "최대"],
      ["HP", "9", String(max.hp)],
      ["MP", "7", String(max.mp)],
      ["SAN", "40", "99"],
      ["행운", "55", "99"],
    ]);
  });

  it("기능은 이름, 값, 성장(O) 순이다", () => {
    const rows = parseCsv(characterToCsv(sample())).rows;
    const at = rows.findIndex((r) => r[0] === "[기능]");
    expect(rows.slice(at + 1, at + 5)).toEqual([["기능", "값", "성장"], ["관찰력", "60", "O"], ["외국어(영어)", "41", ""], ["도서관 이용", "20", ""]]);
  });

  it("쉼표·따옴표·줄바꿈이 있는 글은 따옴표로 감싸 한 칸에 담는다", () => {
    const csv = characterToCsv(sample());
    expect(csv).toContain('"기자, 프리랜서"');
    expect(csv).toContain('"손전등\n""행운의"" 부적, 수첩"');
  });
});

describe("왕복", () => {
  it("내보낸 것을 다시 읽으면 같은 캐릭터다", () => {
    const src = sample();
    const r = ok(characterToCsv(src));
    expect(r.warnings).toEqual([]);
    const d = r.data!;
    expect(d.name).toBe("윤서하");
    expect(d.age).toBe(27);
    expect(d.occupation).toBe("기자, 프리랜서");
    expect(d.characteristics).toEqual(stats);
    expect([d.luck, d.hp, d.mp, d.san]).toEqual([55, 9, 7, 40]);
    expect(d.skills).toEqual([
      { name: "관찰력", value: 60, grown: true },
      { name: "외국어(영어)", value: 41, grown: false },
      { name: "도서관 이용", value: 20, grown: false },
    ]);
    expect(d.weapons).toEqual(src.weapons);
    expect(d.possessions).toBe("손전등\n\"행운의\" 부적, 수첩");
    expect(d.notes).toBe("줄1\n줄2, 쉼표");
    expect(d.backstory).toBe("고향은 아캄.");
  });

  it("읽은 결과는 서버 스키마를 통과하고, 다시 내보내도 같다", () => {
    const first = ok(characterToCsv(sample())).data!;
    expect(characterInputSchema.safeParse(first).success).toBe(true);
    const second = ok(characterToCsv(first)).data!;
    expect(second).toEqual(first);
  });

  it("BOM이 있든 없든, 쉼표든 탭이든 읽는다", () => {
    const plain = characterToCsv(sample(), { bom: false });
    expect(ok(plain).data!.name).toBe("윤서하");
    const tsv = parseCsv(plain).rows.map((r) => r.join("\t")).join("\n");
    // 탭으로 바꾸면 따옴표 안 줄바꿈이 깨지므로 한 줄 글만 있는 시트로 확인한다.
    const small = characterToCsv({ ...sample(), possessions: "", notes: "", backstory: "" }, { bom: false });
    const smallTsv = parseCsv(small).rows.map((r) => r.join("\t")).join("\n");
    expect(ok(smallTsv).data!.skills).toHaveLength(3);
    expect(tsv.length).toBeGreaterThan(0);
  });

  it("수식·주석·구역 표시처럼 보이는 글도 그대로 돌아온다", () => {
    const src: SheetCsvSource = {
      ...sample(),
      name: "=HYPERLINK(\"x\")",
      occupation: "-직업",
      skills: [{ name: "+기능", value: 5 }, { name: "#주석처럼", value: 6 }],
      possessions: "[열쇠]",
      notes: "@멘션",
      backstory: "'=작은따옴표 시작",
    };
    const csv = characterToCsv(src);
    expect(csv).toContain("'=HYPERLINK");
    const d = ok(csv).data!;
    expect(d.name).toBe(src.name);
    expect(d.occupation).toBe("-직업");
    expect(d.skills.map((s) => s.name)).toEqual(["+기능", "#주석처럼"]);
    expect(d.possessions).toBe("[열쇠]");
    expect(d.notes).toBe("@멘션");
    expect(d.backstory).toBe("'=작은따옴표 시작");
  });

  it("룸 안의 시트도 같은 파일로 내보낸다", () => {
    const c: Character = {
      id: "c1", ownerId: "u", name: "시트", age: 30, occupation: "의사", characteristics: stats, luck: 10, hp: 5, mp: 4, san: 30,
      skills: { 의학: { value: 70, grown: true } }, notes: "n", weapons: [], rev: 3,
    };
    const d = ok(characterToCsv(sheetCsvSourceFromCharacter(c))).data!;
    expect(d.skills).toEqual([{ name: "의학", value: 70, grown: true }]);
    expect(d.hp).toBe(5);
  });
});

describe("가져오기 양식", () => {
  const tpl = sheetCsvTemplate();
  it("BOM이 있고 설명 줄(#)과 모든 구역이 있다", () => {
    expect(tpl.startsWith(CSV_BOM)).toBe(true);
    expect(parseCsv(tpl).rows.filter((r) => r[0]!.startsWith("#")).length).toBeGreaterThan(0);
    for (const s of ["[기본 정보]", "[특성치]", "[파생 수치]", "[기능]", "[무기]", "[소지품]", "[비고]"]) expect(tpl).toContain(s);
  });
  it("이름을 채우기 전에는 가져와지지 않고 이유를 알려 준다", () => {
    const r = parseSheetCsv(tpl);
    expect(r.data).toBeUndefined();
    expect(r.errors.map((e) => e.message)).toEqual([expect.stringContaining("이름이 없어요")]);
  });
  it("이름만 채우면 가져와지고 기본 기능이 모두 들어 있다", () => {
    const r = ok(tpl.replace("이름,\r\n", "이름,새 조사자\r\n"));
    expect(r.data!.name).toBe("새 조사자");
    expect(r.data!.skills.map((s) => s.name).sort()).toEqual(defaultSkillValues({ characteristics: r.data!.characteristics }).map((s) => s.name).sort());
    expect(r.data!.hp).toBeUndefined();
    expect(r.warnings).toEqual([]);
    // 행운은 비워 두었으므로 알려 준다.
    expect(r.notes.some((n) => n.message.includes("행운"))).toBe(true);
  });
});

const base = `[기본 정보]
이름,테스터
나이,30
직업,
[특성치]
STR,50
CON,50
SIZ,50
DEX,50
APP,50
INT,50
POW,50
EDU,50
`;

describe("한글 머리글과 느슨한 입력", () => {
  it("구역 이름이 대괄호 없이 있어도, 영문 키·한글 별칭도 읽는다", () => {
    const text = `기본 정보,,
name,별칭
age,33
특성치
근력,40
건강,41
크기,42
민첩,43
외모,44
지능,45
정신력,46
교육,47
`;
    const d = ok(text).data!;
    expect(d.name).toBe("별칭");
    expect(d.characteristics).toEqual({ STR: 40, CON: 41, SIZ: 42, DEX: 43, APP: 44, INT: 45, POW: 46, EDU: 47 });
  });

  it("구글 시트 내보내기처럼 줄마다 쉼표가 붙어 있어도 읽는다", () => {
    const text = base.split("\n").map((l) => (l ? `${l},,,` : l)).join("\n");
    expect(ok(text).data!.name).toBe("테스터");
  });

  it("성장 칸의 여러 표기를 알아본다", () => {
    const d = ok(`${base}[기능]\n기능,값,성장\n감정,5,o\n법률,5,예\n역사,5,✓\n회계,5,X\n오컬트,5,\n수영,20,1\n`).data!;
    expect(Object.fromEntries(d.skills.map((s) => [s.name, s.grown]))).toEqual({ 감정: true, 법률: true, 역사: true, 회계: false, 오컬트: false, 수영: true });
  });

  it("알 수 없는 성장 표기는 체크하지 않고 알려 준다", () => {
    const r = ok(`${base}[기능]\n감정,5,글쎄\n`);
    expect(r.data!.skills[0]!.grown).toBe(false);
    expect(r.notes.some((n) => n.message.includes("성장 칸"))).toBe(true);
  });

  it("버전이 더 높은 양식이면 알려 준다", () => {
    const r = ok(`밤의 탁자 캐릭터 시트,9\n${base}`);
    expect(r.notes[0]!.message).toContain("더 새로운 양식");
  });
});

describe("건너뛴 행과 경고", () => {
  it("범위를 벗어난 기능 값은 그 행만 건너뛰고 행 번호를 알려 준다", () => {
    const text = `${base}[기능]\n감정,5,\n법률,101,\n역사,-3,\n회계,abc,\n오컬트,,\n수영,20,\n`;
    const r = ok(text);
    expect(r.data!.skills.map((s) => s.name)).toEqual(["감정", "수영"]);
    expect(r.skippedRows).toBe(4);
    expect(r.warnings.map((w) => w.row)).toEqual([16, 17, 18, 19]);
    expect(r.warnings[0]!.message).toContain("법률");
  });

  it("목록에 없는 기능 이름은 그대로 가져오되 알려 준다", () => {
    const r = ok(`${base}[기능]\n외국어(영어),30,\n관찰럭,25,\n`);
    expect(r.data!.skills.map((s) => s.name)).toEqual(["외국어(영어)", "관찰럭"]);
    const unknown = r.notes.filter((n) => n.message.includes("기본 기능 목록에 없는"));
    expect(unknown).toHaveLength(1);
    expect(unknown[0]!.message).toContain("관찰럭");
    expect(isKnownSkillName("과학(화학)")).toBe(true);
    expect(isKnownSkillName("마법")).toBe(false);
  });

  it("같은 기능이 두 번이면 뒤의 것을 건너뛴다", () => {
    const r = ok(`${base}[기능]\n감정,5,\n감정,50,\n`);
    expect(r.data!.skills).toEqual([{ name: "감정", value: 5, grown: false }]);
    expect(r.skippedRows).toBe(1);
  });

  it("이름이 30자를 넘거나 비어 있으면 건너뛴다", () => {
    const r = ok(`${base}[기능]\n${"가".repeat(31)},5,\n,5,\n`);
    expect(r.data!.skills).toEqual([]);
    expect(r.skippedRows).toBe(2);
  });

  it("기능이 150개를 넘으면 나머지를 건너뛴다", () => {
    const lines = Array.from({ length: 155 }, (_, i) => `기능${i},10,`).join("\n");
    const r = ok(`${base}[기능]\n${lines}\n`);
    expect(r.data!.skills).toHaveLength(150);
    expect(r.skippedRows).toBe(5);
    expect(r.notes.some((n) => n.message.includes("150"))).toBe(true);
  });

  it("무기는 서버 규칙(피해 식, 길이, 12개)을 따른다", () => {
    const text = `${base}[무기]\n이름,기능,피해\n주먹,맨손 격투,1d3+db\n마법봉,오컬트,아주 세게\n,사격(권총),1d6\n칼,,1d4\n` + Array.from({ length: 12 }, (_, i) => `총${i},사격(권총),1d6`).join("\n") + "\n";
    const r = ok(text);
    expect(r.data!.weapons).toHaveLength(12);
    expect(r.data!.weapons![0]).toEqual({ name: "주먹", skill: "맨손 격투", damage: "1d3+db" });
    expect(r.warnings.find((w) => w.message.includes("마법봉"))!.message).toContain("주사위 식");
    expect(r.warnings.filter((w) => w.row).length).toBe(3 + 1); // 잘못된 3줄 + 12개를 넘은 1줄
  });

  it("알 수 없는 구역과 구역 앞의 줄은 건너뛴다", () => {
    const r = ok(`딴소리,1\n[잡동사니]\n가,나\n${base}`);
    expect(r.data!.name).toBe("테스터");
    expect(r.warnings.map((w) => w.row)).toEqual([1, 2, 3]);
  });

  it("알 수 없는 기본 정보·비고 항목은 건너뛴다", () => {
    const r = ok(`${base}[비고]\n메모,m\n혈액형,A\n인물 배경,b\n`);
    expect(r.data!.notes).toBe("m");
    expect(r.data!.backstory).toBe("b");
    expect(r.skippedRows).toBe(1);
  });

  it("현재 HP가 최대보다 크면 최대로 맞추고, 최대가 다르면 다시 계산한다고 알린다", () => {
    const r = ok(`${base}[파생 수치]\n항목,현재,최대\nHP,30,99\nMP,3,10\nSAN,70,99\n행운,60,99\n`);
    expect(r.data!.hp).toBe(10);
    expect(r.data!.mp).toBe(3);
    expect(r.data!.san).toBe(70);
    expect(r.data!.luck).toBe(60);
    expect(r.warnings.map((w) => w.message).join()).toContain("HP 현재값 30");
    expect(r.notes.map((n) => n.message).join()).toContain("HP 최대 99");
  });

  it("범위 밖이거나 숫자가 아닌 현재 수치는 건너뛴다", () => {
    const r = ok(`${base}[파생 수치]\nHP,abc,10\nMP,100,10\nSAN,,99\n행운,5,99\n`);
    expect(r.data!.hp).toBeUndefined();
    expect(r.data!.mp).toBeUndefined();
    expect(r.skippedRows).toBe(2);
  });

  it("너무 긴 글은 서버 한도까지만 가져온다", () => {
    const r = ok(`${base}[소지품]\n"${"가".repeat(1200)}"\n[비고]\n메모,"${"나".repeat(2100)}"\n`);
    expect(r.data!.possessions).toHaveLength(1000);
    expect(r.data!.notes).toHaveLength(2000);
    expect(r.warnings).toHaveLength(2);
  });

  it("소지품이 여러 줄이면 줄바꿈으로 잇고, 칸이 여러 개면 쉼표로 잇는다", () => {
    const r = ok(`${base}[소지품]\n손전등\n밧줄,3개\n`);
    expect(r.data!.possessions).toBe("손전등\n밧줄, 3개");
  });
});

describe("가져올 수 없는 입력", () => {
  it("구역이 하나도 없으면 안내한다", () => {
    const r = parseSheetCsv("아무,글이나\n1,2");
    expect(r.data).toBeUndefined();
    expect(r.errors[0]!.message).toContain("양식 받기");
  });

  it("빈 글은 오류다", () => {
    expect(parseSheetCsv("").errors).toHaveLength(1);
    expect(parseSheetCsv("   \n\n").errors).toHaveLength(1);
  });

  it("범위를 벗어난 특성치와 나이는 오류다", () => {
    const r = parseSheetCsv(base.replace("STR,50", "STR,150").replace("나이,30", "나이,10").replace("DEX,50", "DEX,0"));
    expect(r.data).toBeUndefined();
    expect(r.errors.map((e) => e.message).join("\n")).toMatch(/STR.*1~99/);
    expect(r.errors.map((e) => e.message).join("\n")).toMatch(/나이.*15~90/);
    expect(r.errors.map((e) => e.message).join("\n")).toMatch(/DEX.*1~99/);
    expect(r.errors.every((e) => e.row !== undefined)).toBe(true);
  });

  it("빠진 특성치는 이름을 들어 알려 준다", () => {
    const r = parseSheetCsv(base.replace("EDU,50\n", "").replace("POW,50\n", ""));
    expect(r.errors).toEqual([{ message: "특성치가 빠졌어요: POW, EDU" }]);
  });

  it("이름이 너무 길면 오류다", () => {
    const r = parseSheetCsv(base.replace("테스터", "가".repeat(41)));
    expect(r.errors.map((e) => e.message)).toEqual([expect.stringContaining("이름은 40자")]);
  });

  it("1MB를 넘는 글은 읽지 않는다", () => {
    const r = parseSheetCsv("가".repeat(SHEET_CSV_MAX_CHARS + 1));
    expect(r.errors[0]!.message).toContain("너무 길어요");
  });

  it("아무 키나 눌러 만든 글이 던지지 않는다", () => {
    for (const junk of ['"', '"""', "[", "[]", "[기능]\n\"", ",,,,\n,,,", "\u0000\u0001", "[기본 정보]\n\"이름", "#\n#\n"]) {
      expect(() => parseSheetCsv(junk)).not.toThrow();
    }
  });
});

describe("기본 특성치 표", () => {
  it("모든 특성치 이름이 내보내기에 나온다", () => {
    const csv = characterToCsv(sample());
    for (const k of CHARACTERISTIC_KEYS) expect(csv).toContain(`${k},${stats[k]}`);
  });
});
