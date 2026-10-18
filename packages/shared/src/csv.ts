/** 아주 작은 CSV/TSV 읽기·쓰기. 따옴표 안의 쉼표·줄바꿈, 큰따옴표 두 번(""), BOM, CRLF를 다룬다. */

export const CSV_BOM = "﻿";

export type Delimiter = "," | "\t" | ";";

/** 첫 몇 줄에서 따옴표 밖의 구분자를 세어 가장 많은 것을 고른다. 구글 시트에서 복사하면 탭, 파일은 쉼표다. */
export function detectDelimiter(text: string): Delimiter {
  const counts: Record<Delimiter, number> = { ",": 0, "\t": 0, ";": 0 };
  let quoted = false;
  let lines = 0;
  for (let i = 0; i < text.length && lines < 6; i++) {
    const ch = text[i]!;
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      lines++;
    } else if (!quoted && (ch === "," || ch === "\t" || ch === ";")) counts[ch]++;
  }
  // 동률이면 쉼표. 세미콜론은 쉼표가 하나도 없을 때만 쓴다(문장 속 ;를 구분자로 오해하지 않도록).
  if (counts["\t"] > counts[","]) return "\t";
  if (counts[","] === 0 && counts[";"] > 0 && counts[";"] >= counts["\t"]) return ";";
  return ",";
}

export interface ParsedCsv {
  rows: string[][];
  delimiter: Delimiter;
  /** 따옴표가 닫히지 않은 채 끝났다 */
  unterminatedQuote: boolean;
}

/** 글을 칸 배열로 나눈다. 구분자를 안 주면 알아서 고른다. 맨 앞 BOM은 버린다. */
export function parseCsv(text: string, delimiter?: Delimiter): ParsedCsv {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const d = delimiter ?? detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let wasQuoted = false; // 이 칸이 따옴표로 시작했는지(빈 문자열 "" 과 아무것도 없는 칸을 구분하지는 않지만, 따옴표 뒤 글자를 이어 붙이기 위해 쓴다)
  let any = false; // 현재 줄에 뭔가 읽었는지

  const endCell = () => {
    row.push(cell);
    cell = "";
    wasQuoted = false;
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
    any = false;
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "" && !wasQuoted) {
      quoted = true;
      wasQuoted = true;
      any = true;
    } else if (ch === d) {
      endCell();
      any = true;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      endRow();
    } else {
      cell += ch;
      any = true;
    }
  }
  const unterminatedQuote = quoted;
  if (any || cell !== "" || row.length > 0) endRow();
  return { rows, delimiter: d, unterminatedQuote };
}

/** 엑셀이 수식으로 읽을 수 있는 글자(= + - @)와 우리 쪽 주석(#)·구역 표시([)로 시작하는 글은 앞에 '를 붙여 글자로 고정한다. */
const GUARDED = /^'*[=+\-@#\t\r[［【]/;
export const guardCell = (text: string): string => (GUARDED.test(text) ? `'${text}` : text);
export const unguardCell = (text: string): string => (/^'+[=+\-@#\t\r[［【]/.test(text) ? text.slice(1) : text);

const needsQuote = (s: string) => /[",\r\n\t;]/.test(s) || s !== s.trim();

/** 칸 하나를 CSV 글로 만든다(쉼표·따옴표·줄바꿈·앞뒤 공백이 있으면 따옴표로 감싼다). */
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return needsQuote(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 칸 배열을 CSV 글로 만든다. 줄 끝은 엑셀이 좋아하는 CRLF다. BOM은 붙이지 않는다. */
export function serializeCsv(rows: ReadonlyArray<ReadonlyArray<string | number | boolean | null | undefined>>): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
