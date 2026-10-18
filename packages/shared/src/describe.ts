import { LEVEL_LABEL_KO, type RollOutcome } from "./dice";
import { MADNESS_LABEL_KO } from "./sheet";

const DIFFICULTY_KO = { regular: "보통", hard: "어려움", extreme: "극단적", critical: "대성공" } as const;

/** 굴림 결과를 한국어 한 줄로. 화면과 디스코드 알림이 같은 문장을 쓴다. */
export function describeOutcome(o: RollOutcome): string {
  switch (o.kind) {
    case "dice": {
      const mod = o.modifier ? (o.modifier > 0 ? `+${o.modifier}` : `${o.modifier}`) : "";
      return `[${o.rolls.join(", ")}]${mod} = ${o.total}`;
    }
    case "cc": {
      const bonus = o.percent.bonus ? ` (${o.percent.bonus > 0 ? "보너스" : "페널티"} ${Math.abs(o.percent.bonus)})` : "";
      if (o.level === undefined) return `${o.percent.total}${bonus}`;
      const luck = o.luckSpent ? ` (행운 −${o.luckSpent})` : "";
      const need = o.difficulty ? DIFFICULTY_KO[o.difficulty] : "";
      const verdict = o.difficulty && o.success !== undefined ? (o.success ? ` · ${need} 통과` : o.level === "failure" || o.level === "fumble" ? "" : ` · ${need}에 못 미침`) : "";
      return `${o.percent.total}${bonus}${luck} → ${LEVEL_LABEL_KO[o.level]}${verdict}`;
    }
    case "san": {
      const int = o.int ? ` · INT ${o.int.roll} ${o.int.success ? "성공" : "실패"}` : "";
      const madness = o.madness ? ` · ${MADNESS_LABEL_KO[o.madness]}` : "";
      return `${o.percent.total} → ${LEVEL_LABEL_KO[o.level]} · SAN ${o.before} → ${o.after} (−${o.loss})${int}${madness}`;
    }
    case "cbr":
      return `${o.roll} → ${o.x.target}: ${LEVEL_LABEL_KO[o.x.level]} / ${o.y.target}: ${LEVEL_LABEL_KO[o.y.level]}`;
  }
}
