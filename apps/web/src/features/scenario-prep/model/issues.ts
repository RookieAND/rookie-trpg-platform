/** 가져오기 오류를 한국어 위치·문장으로 바꾼다. (shared 의 문장은 영문 경로를 그대로 담고 있다) */

const SECTION: Record<string, string> = {
  scenes: "장면",
  tokens: "토큰·소품",
  characters: "시트",
  handouts: "핸드아웃",
  beats: "비트",
  branches: "분기",
  audio: "음원",
  images: "이미지",
  madnessTable: "광기표",
};

const FIELD: Record<string, string> = {
  key: "key(이름표)",
  name: "이름",
  title: "제목",
  kind: "종류",
  scene: "장면",
  character: "시트",
  x: "가로 위치",
  y: "세로 위치",
  body: "내용",
  label: "이름",
  from: "출발 비트",
  to: "도착 비트",
  bgm: "배경음",
  format: "형식",
  version: "버전",
  roomName: "룸 이름",
};

/** `tokens[2] (낡은 상자) · x` → `3번째 토큰·소품 (낡은 상자) · 가로 위치` */
export function whereKo(where: string): string {
  if (where === "파일") return where;
  const m = /^([A-Za-z]+)\[(\d+)\](.*)$/.exec(where);
  if (m) {
    const sec = SECTION[m[1]!] ?? m[1]!;
    const rest = m[3]!.replace(/(\s·\s|\.)([A-Za-z]+)\b/g, (_, sep: string, f: string) => `${sep === "." ? " · " : sep}${FIELD[f] ?? f}`);
    return `${Number(m[2]) + 1}번째 ${sec}${rest}`;
  }
  const top = /^([A-Za-z]+)(.*)$/.exec(where);
  if (top) return `${SECTION[top[1]!] ?? FIELD[top[1]!] ?? top[1]!}${top[2]!.replace(/\.([A-Za-z]+)/g, (_, f: string) => ` · ${FIELD[f] ?? f}`)}`;
  return where;
}

/** 오류 한 줄: `3번째 토큰·소품 (낡은 상자): 종류가 없어요.` */
export function issueLine(where: string, message: string): string {
  let msg = message;
  const missing = /^빠졌어요\.$/.test(msg);
  if (missing) msg = "빠졌어요. 꼭 있어야 하는 항목이에요.";
  // 영문 항목 이름이 문장에 섞여 있으면 한국어로 바꾼다
  const dup = /^key "(.+)"가 겹쳐요\.$/.exec(msg);
  if (dup) msg = `이름표(key) "${dup[1]}"가 다른 항목과 겹쳐요. 하나씩만 쓸 수 있어요.`;
  msg = msg.replace(/^scene "(.+)"이 scenes에 없어요\.$/, '장면 "$1"이 장면 목록에 없어요. key 철자를 확인해 주세요.');
  msg = msg.replace(/^character "(.+)"가 characters에 없어요\./, '시트 "$1"가 시트 목록에 없어요.');
  return `${whereKo(where)}: ${msg}`;
}

/** JSON.parse 가 낸 위치(문자 번호)를 줄·칸으로 바꾼 한국어 문장. 위치를 모르면 일반 문장. */
export function jsonSyntaxMessage(text: string, e: unknown): string {
  const raw = e instanceof Error ? e.message : "";
  const pos = /position (\d+)/.exec(raw);
  const lc = /line (\d+) column (\d+)/.exec(raw);
  let line: number | undefined;
  let col: number | undefined;
  if (lc) {
    line = Number(lc[1]);
    col = Number(lc[2]);
  } else if (pos) {
    [line, col] = lineCol(text, Number(pos[1]));
  } else {
    // 위치 없이 `Unexpected token '}', ..."앞뒤 글"... is not valid JSON` 만 오는 엔진: 그 앞뒤 글로 위치를 찾는다
    const m = /Unexpected token '(.)', (\.\.\.)?"([\s\S]*)" is not valid JSON/.exec(raw);
    if (m) {
      const snippet = m[3]!;
      const at = text.indexOf(snippet);
      const tok = snippet.indexOf(m[1]!, m[2] ? Math.min(10, snippet.length - 1) : 0);
      if (at >= 0 && tok >= 0) [line, col] = lineCol(text, at + tok);
    }
  }
  const where = line !== undefined ? `${line}번째 줄 ${col}번째 칸 근처에서 ` : "";
  return `${where}JSON 형식이 맞지 않아요. 쉼표나 따옴표, 괄호가 빠졌거나 남았는지 봐 주세요.`;
}

function lineCol(text: string, pos: number): [number, number] {
  const parts = text.slice(0, pos).split("\n");
  return [parts.length, parts[parts.length - 1]!.length + 1];
}
