import { describe, expect, it } from "vitest";
import { CSV_BOM, csvCell, detectDelimiter, guardCell, parseCsv, serializeCsv, unguardCell } from "./csv";

describe("parseCsv", () => {
  it("쉼표로 나누고 CRLF·LF·CR 줄 끝을 모두 읽는다", () => {
    expect(parseCsv("a,b\r\nc,d\ne,f\rg,h").rows).toEqual([["a", "b"], ["c", "d"], ["e", "f"], ["g", "h"]]);
  });

  it("맨 앞 BOM은 버린다", () => {
    expect(parseCsv(`${CSV_BOM}이름,값\n나,1`).rows[0]).toEqual(["이름", "값"]);
  });

  it("따옴표 안의 쉼표·줄바꿈·큰따옴표(\"\")를 한 칸으로 읽는다", () => {
    const r = parseCsv('a,"x, y","줄1\r\n줄2","he said ""hi"""\n');
    expect(r.rows).toEqual([["a", "x, y", "줄1\r\n줄2", 'he said "hi"']]);
    expect(r.unterminatedQuote).toBe(false);
  });

  it("끝 빈 칸과 빈 줄을 그대로 둔다", () => {
    expect(parseCsv("a,,\n\nb,").rows).toEqual([["a", "", ""], [""], ["b", ""]]);
  });

  it("끝의 줄바꿈은 빈 행을 만들지 않는다", () => {
    expect(parseCsv("a,b\n").rows).toHaveLength(1);
    expect(parseCsv("").rows).toEqual([]);
  });

  it("따옴표가 안 닫히면 표시하고 남은 글을 한 칸으로 읽는다", () => {
    const r = parseCsv('a,"b,c\nd');
    expect(r.unterminatedQuote).toBe(true);
    expect(r.rows).toEqual([["a", "b,c\nd"]]);
  });

  it("칸 한가운데의 따옴표는 글자로 읽는다", () => {
    expect(parseCsv('5" 못,x').rows).toEqual([['5" 못', "x"]]);
  });

  it("구글 시트에서 복사한 탭 글을 알아본다", () => {
    const tsv = "[기본 정보]\t\t\n이름\t윤서하\t\n나이\t25\t";
    expect(detectDelimiter(tsv)).toBe("\t");
    expect(parseCsv(tsv).rows[1]).toEqual(["이름", "윤서하", ""]);
  });

  it("세미콜론은 쉼표가 없을 때만 구분자로 본다", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a,b;c\n1,2;3")).toBe(",");
    expect(detectDelimiter("한 칸짜리 글")).toBe(",");
  });

  it("따옴표 안의 탭·쉼표는 구분자 판단에서 뺀다", () => {
    expect(detectDelimiter('"a\tb\tc\td",x\n1,2')).toBe(",");
  });
});

describe("serializeCsv", () => {
  it("쉼표·따옴표·줄바꿈·앞뒤 공백이 있는 칸만 따옴표로 감싼다", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "x"')).toBe('"say ""x"""');
    expect(csvCell("줄1\n줄2")).toBe('"줄1\n줄2"');
    expect(csvCell(" 공백")).toBe('" 공백"');
    expect(csvCell(7)).toBe("7");
    expect(csvCell(null)).toBe("");
  });

  it("줄 끝은 CRLF이고 BOM은 붙이지 않는다", () => {
    const out = serializeCsv([["a", 1], [], ["b", ""]]);
    expect(out).toBe("a,1\r\n\r\nb,\r\n");
    expect(out.startsWith(CSV_BOM)).toBe(false);
  });

  it("무엇이든 쓴 대로 다시 읽힌다", () => {
    const rows = [["a,b", 'q"q', "줄1\r\n줄2", " 앞공백", "한글"], ["", "x", ""]];
    expect(parseCsv(serializeCsv(rows)).rows).toEqual(rows);
  });
});

describe("수식 방지", () => {
  it("= + - @ # [ 로 시작하는 글은 앞에 '를 붙이고 읽을 때 뗀다", () => {
    for (const s of ["=1+1", "+x", "-1", "@a", "#메모", "[열쇠]", "'=이미따옴표"]) {
      expect(guardCell(s).startsWith("'")).toBe(true);
      expect(unguardCell(guardCell(s))).toBe(s);
    }
  });
  it("평범한 글과 중간의 기호는 그대로 둔다", () => {
    for (const s of ["열쇠", "a=b", "it's", "'따옴표 시작", ""]) expect(guardCell(s)).toBe(s);
    expect(unguardCell("'따옴표 시작")).toBe("'따옴표 시작");
  });
});
