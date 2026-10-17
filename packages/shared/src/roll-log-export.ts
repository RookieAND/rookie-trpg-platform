import { describeOutcome } from "./describe";
import type { RollLogEntry } from "./protocol";

export interface RollLogExportOptions {
  /** 본문 첫 줄에 쓸 제목(룸 이름 등) */
  title?: string;
  /** 보는 사람이 KP인지. KP가 아니면 받지 못한 비밀 굴림이 빠졌다는 안내를 붙인다. */
  isKp: boolean;
  /** 시각 표시에 쓸 시간대(기본은 실행 환경의 시간대) */
  timeZone?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

const clock = (at: number, timeZone?: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? pad(0);
  return `${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
};

/**
 * 굴림 기록을 사람이 읽을 수 있는 마크다운으로 만든다. 세션마다 묶고 오래된 굴림이 위에 온다.
 * 이미 받은 기록만 쓰므로, 보는 사람이 볼 수 없던 굴림은 담기지 않는다.
 */
export function formatRollLog(rolls: readonly RollLogEntry[], opts: RollLogExportOptions): string {
  const lines: string[] = [`# ${opts.title?.trim() || "굴림 기록"}`, ""];
  if (!opts.isKp) lines.push("> 이 화면에서 볼 수 있었던 굴림만 담겨 있어요. KP의 비밀 굴림은 들어 있지 않아요.", "");
  if (rolls.length === 0) {
    lines.push("굴림이 없어요.");
    return lines.join("\n") + "\n";
  }
  const sorted = [...rolls].sort((a, b) => a.at - b.at);
  let session: number | null = null;
  for (const r of sorted) {
    if (r.session !== session) {
      session = r.session;
      if (lines[lines.length - 1] !== "") lines.push("");
      lines.push(r.session > 0 ? `## 세션 ${r.session}` : "## 세션 시작 전", "");
    }
    const tags = [r.secret ? "비밀" : "", r.pushOf ? "푸시" : "", r.luckOf ? "행운" : ""].filter(Boolean);
    const who = r.label ? `${r.userName} · ${r.label}` : r.userName;
    lines.push(`- ${clock(r.at, opts.timeZone)} **${who}** \`${r.expr}\` — ${describeOutcome(r.outcome)}${tags.length ? ` (${tags.join(", ")})` : ""}`);
  }
  return lines.join("\n") + "\n";
}
