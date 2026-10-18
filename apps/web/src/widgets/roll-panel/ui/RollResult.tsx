"use client";
import "./roll-result.css";
import { describeOutcome, MADNESS_LABEL_KO, type Difficulty, type RollOutcome, type SuccessLevel } from "@coc-vtt/shared";
import { Hint } from "@/shared/ui";

type Cc = Extract<RollOutcome, { kind: "cc" }>;

/** 화면에서는 ‘성공’을 ‘보통 성공’으로 풀어 쓴다(어려운·극단적 성공과 구분). */
export const LEVEL_NAME: Record<SuccessLevel, string> = {
  critical: "대성공",
  extreme: "극단적 성공",
  hard: "어려운 성공",
  regular: "보통 성공",
  failure: "실패",
  fumble: "대실패",
};

export const LEVEL_HELP: Record<SuccessLevel, string> = {
  critical: "굴림이 1이 나왔어요. 가장 좋은 결과예요.",
  extreme: "굴림이 목표값의 1/5 이하로 나왔어요.",
  hard: "굴림이 목표값의 절반 이하로 나왔어요.",
  regular: "굴림이 목표값 이하로 나왔어요. 가장 낮은 성공이에요.",
  failure: "굴림이 목표값보다 높게 나왔어요.",
  fumble: "목표값이 50 미만이면 96 이상, 50 이상이면 100이 나왔어요. 나쁜 일이 생겨요.",
};

const DIFF_NAME: Record<Difficulty, string> = { regular: "보통", hard: "어려움", extreme: "극단적", critical: "대성공" };

export function LevelBadge({ level }: { level: SuccessLevel }) {
  return (
    <span className={`lv lv-${level}`} data-level={level}>
      <Hint title={LEVEL_NAME[level]} text={LEVEL_HELP[level]}>{LEVEL_NAME[level]}</Hint>
    </span>
  );
}

/** 이 난이도에서 성공하려면 굴림이 이 값 이하여야 한다. */
const limitOf = (target: number, d?: Difficulty) => (d === "extreme" ? Math.floor(target / 5) : d === "hard" ? Math.floor(target / 2) : target);

/** 10의 자리 주사위가 여러 개일 때 어떤 값이 나와 무엇을 골랐는지. */
function diceDetail(p: Cc["percent"]): string | null {
  if (!p.bonus) return null;
  const kind = p.bonus > 0 ? "보너스" : "페널티";
  const tens = p.tens.map((t) => (t === 0 && p.units === 0 ? "00" : `${t}0`)).join(", ");
  const chosen = p.chosenTens === 0 && p.units === 0 ? "00" : `${p.chosenTens}0`;
  return `${kind} 주사위 ${Math.abs(p.bonus)}개: 10의 자리 ${tens} 중 ${chosen}을 골랐어요 (1의 자리 ${p.units})`;
}

function CcResult({ o }: { o: Cc }) {
  const p = o.percent;
  if (o.level === undefined || o.target === undefined) {
    return (
      <div className="res">
        <div className="res-main"><b className="mono">{p.total}</b></div>
        {diceDetail(p) && <div className="res-sub">{diceDetail(p)}</div>}
      </div>
    );
  }
  const limit = limitOf(o.target, o.difficulty);
  const bonus = p.bonus ? ` · ${p.bonus > 0 ? "보너스" : "페널티"} ${Math.abs(p.bonus)}` : "";
  const diff = o.difficulty ? DIFF_NAME[o.difficulty] : null;
  const gap = diff && o.success === false && o.level !== "failure" && o.level !== "fumble";
  return (
    <div className="res">
      <div className="res-main">
        <LevelBadge level={o.level} />
        <span className="mono">
          <b>{p.total}</b> / 목표 {limit}
        </span>
        <span className="res-sub">
          {diff ? `${diff}${o.difficulty !== "regular" ? ` (기능 ${o.target})` : ""}` : `기능 ${o.target}`}
          {bonus}
        </span>
      </div>
      {gap && <div className="res-sub warn">{LEVEL_NAME[o.level]}이지만 {diff} 기준({limit} 이하)에는 못 미쳐요.</div>}
      {diff && o.success === true && o.level !== "failure" && <div className="res-sub">{diff} 이상이라 통과했어요.</div>}
      {o.luckSpent ? <div className="res-sub">행운 {o.luckSpent}을 써서 {p.total + o.luckSpent}이 {p.total}이 됐어요.</div> : null}
      {diceDetail(p) && <div className="res-sub">{diceDetail(p)}</div>}
    </div>
  );
}

function SanResult({ o }: { o: Extract<RollOutcome, { kind: "san" }> }) {
  return (
    <div className="res">
      <div className="res-main">
        <LevelBadge level={o.level} />
        <span className="mono">
          <b>{o.percent.total}</b> / SAN {o.target}
        </span>
        <span className="res-sub">
          SAN <b className="mono">{o.before}</b> → <b className="mono">{o.after}</b> (−{o.loss})
        </span>
      </div>
      {o.int && (
        <div className="res-sub">
          INT 판정 {o.int.roll} / {o.int.target} {o.int.success ? "성공: 충격을 깨달아 일시적 광기에 빠져요." : "실패: 충격을 떨쳐 내서 광기에 빠지지 않아요."}
        </div>
      )}
      {o.madness && (
        <div className="res-sub warn">
          {MADNESS_LABEL_KO[o.madness]}
          {o.madness === "indefinite" ? ": 오늘 잃은 SAN이 하루 한도를 넘었어요." : o.madness === "permanent" ? ": SAN이 0이 됐어요." : ""}
        </div>
      )}
      <div className="res-sub">오늘 누적 손실 {o.dailyLoss}</div>
    </div>
  );
}

/** 굴림 결과를 성공 단계(색+글자), 목표값·굴림값·주사위 내역으로 풀어 보여 준다. */
export function RollResult({ outcome: o }: { outcome: RollOutcome }) {
  if (o.kind === "cc") return <CcResult o={o} />;
  if (o.kind === "san") return <SanResult o={o} />;
  return <div className="mono">{describeOutcome(o)}</div>;
}
