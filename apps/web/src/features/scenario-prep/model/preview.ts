import { countScenario, countsLine, parseScenarioText, type ScenarioCounts } from "@coc-vtt/shared";

/** 파일 글을 브라우저에서 먼저 검사한 결과. 서버로 보내기 전에 형식 문제를 위치별로 알려 준다. */
export type LocalPreview =
  | { ok: true; counts: ScenarioCounts; line: string; warnings: string[]; roomName: string; kind: "scenario" | "backup" }
  | { ok: false; errors: string[] };

export function previewLocal(text: string): LocalPreview {
  if (!text.trim()) return { ok: false, errors: ["파일이 비어 있어요."] };
  const r = parseScenarioText(text);
  if (!r.ok) return { ok: false, errors: r.errors.map((e) => `${e.where}: ${e.message}`) };
  const counts = countScenario(r.doc);
  return { ok: true, counts, line: countsLine(counts), warnings: r.warnings, roomName: r.doc.roomName, kind: r.doc.format === "roll-and-call-backup" ? "backup" : "scenario" };
}

/** 내려받는 파일 이름에 못 쓰는 글자를 바꾼다. */
export function safeFileName(name: string, suffix: string): string {
  const base = name.trim().replace(/[^\w가-힣ㄱ-ㅎㅏ-ㅣ-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return `${base || "room"}-${suffix}.json`;
}

/** 가져온 결과를 토스트 한 줄로 */
export function importedText(line: string, warnings: number): string {
  return `가져왔어요 · ${line || "가져올 것이 없어요"}${warnings > 0 ? ` (주의 ${warnings}건)` : ""}`;
}
