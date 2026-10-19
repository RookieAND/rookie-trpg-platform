import { clientCommandSchema, josa, LIMITS, type LimitKey } from "@coc-vtt/shared";

/** "핸드아웃 제목은 60자까지예요." */
export function limitMessage(label: string, max: number): string {
  return `${josa(label, "은/는")} ${max}자까지예요.`;
}

/** 칸 이름 붙은 한도 안내. 한도에 닿았을 때만 문구를 돌려준다. */
export function limitNote(label: string, key: LimitKey, value: string): string | null {
  return value.length >= LIMITS[key] ? limitMessage(label, LIMITS[key]) : null;
}

/** [명령 종류, 값 위치(점으로 이은 경로, 숫자는 *)] → 화면에서 부르는 칸 이름 */
const FIELD_LABELS: Array<[string, RegExp, string]> = [
  ["object.add", /^name$/, "토큰·소품 이름"],
  ["object.update", /^name$/, "토큰·소품 이름"],
  ["object.marker", /^text$/, "표식 글"],
  ["scene.create", /^name$/, "장면 이름"],
  ["scene.rename", /^name$/, "장면 이름"],
  ["handout.create", /^title$/, "핸드아웃 제목"],
  ["handout.update", /^title$/, "핸드아웃 제목"],
  ["handout.create", /^body$/, "핸드아웃 내용"],
  ["handout.update", /^body$/, "핸드아웃 내용"],
  ["character.add", /^name$/, "캐릭터 이름"],
  ["character.add", /^occupation$/, "직업"],
  ["character.add", /^notes$/, "메모"],
  ["character.add", /^backstory$/, "인물 배경"],
  ["character.add", /^possessions$/, "소지품"],
  ["character.add", /^skills\.\*\.name$/, "기능 이름"],
  ["character.add", /^weapons\.\*\.name$/, "무기 이름"],
  ["character.add", /^weapons\.\*\.skill$/, "무기 기능"],
  ["character.add", /^weapons\.\*\.damage$/, "무기 피해 식"],
  ["character.add", /^age$/, "나이"],
  ["chat.send", /^text$/, "대화"],
  ["initiative.add", /^name$/, "이름"],
  ["roll.ask", /^name$/, "기능 이름"],
  ["roll.group", /^name$/, "기능 이름"],
  ["san.check", /^loss$/, "SAN 손실 식"],
];

/**
 * 서버가 "메시지 형식이 맞지 않아요"만 돌려줄 때, 보낸 명령을 규격으로 다시 검사해 어느 칸이 문제인지 한 문장으로 말한다.
 * 규격을 통과하면(서버 쪽 사정이면) null이다.
 */
export function badCommandMessage(command: unknown): string | null {
  const r = clientCommandSchema.safeParse(command);
  if (r.success) return null;
  const type = (command as { type?: string } | null)?.type ?? "";
  const issue = r.error.issues[0];
  if (!issue) return null;
  const path = issue.path.slice(1).map((p) => (typeof p === "number" ? "*" : String(p))).join(".");
  const label = FIELD_LABELS.find(([t, re]) => t === type && re.test(path))?.[2];
  if (!label) return null;
  if (issue.code === "too_big" && issue.type === "string") return limitMessage(label, Number(issue.maximum));
  if (issue.code === "too_small" && issue.type === "string") return `${josa(label, "을/를")} 적어 주세요.`;
  if (/[가-힣]/.test(issue.message)) return `${label}: ${issue.message}`;
  return `${josa(label, "을/를")} 확인해 주세요.`;
}
