import { describeOutcome, type RollLogEntry } from "@coc-vtt/shared";

/** 시트에서 굴린 결과를 토스트 한 줄로. 굴림 탭으로 옮기지 않아도 바로 결과를 볼 수 있게 한다. */
export function rollToastText(r: Pick<RollLogEntry, "label" | "expr" | "outcome" | "secret">): string {
  const head = r.label ?? r.expr;
  return `${r.secret ? "비밀 굴림 · " : ""}${head} · ${describeOutcome(r.outcome)}`;
}

/** 시트에서 굴린 직후(제한 시간 안)에 내 이름으로 새 굴림이 왔을 때만 토스트를 띄운다. */
export function shouldToastRoll(askedAt: number, now: number, rollUserId: string, myId: string, windowMs = 8000): boolean {
  return askedAt > 0 && now - askedAt <= windowMs && rollUserId === myId;
}
