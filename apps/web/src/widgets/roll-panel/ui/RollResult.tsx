"use client";
import "./roll-result.css";
import { describeOutcome, josa, luckSpentText, MADNESS_LABEL_KO, type Difficulty, type RollOutcome, type SuccessLevel } from "@coc-vtt/shared";
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
  return `${kind} 주사위 ${Math.abs(p.bonus)}개: 10의 자리 ${tens} 중 ${josa(String(chosen), "을/를")} 골랐어요 (1의 자리 ${p.units})`;
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
      {o.luckSpent ? <div className="res-sub">{luckSpentText(o.luckSpent, p.total)}</div> : null}
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

type Dice = Extract<RollOutcome, { kind: "dice" }>;

/** 주사위 식: 여러 항·괄호·곱셈·db가 있으면 계산식과 항별 결과를 풀어 보여 준다. */
function DiceResult({ o }: { o: Dice }) {
  if (!o.terms || !o.breakdown) return <div className="mono">{describeOutcome(o)}</div>;
  return (
    <div className="res" data-testid="dice-expr-result">
      <div className="res-main">
        <b className="mono" data-testid="dice-total">{o.total}</b>
        <span className="res-sub mono" data-testid="dice-breakdown">{o.breakdown}</span>
      </div>
      <div className="res-terms res-sub" data-testid="dice-terms">
        {o.terms.map((t, i) => (
          <span key={i} className="mono" data-testid="dice-term">
            {t.text}{t.rolls.length ? ` [${t.rolls.length <= 20 ? t.rolls.join(", ") : `${t.rolls.length}개`}]` : ""} = {t.sum}
          </span>
        ))}
      </div>
    </div>
  );
}

function SideLine({ side, win }: { side: Extract<RollOutcome, { kind: "opposed" }>["a"]; win: boolean }) {
  return (
    <div className={`opp-side${win ? " win" : ""}`} data-testid="opposed-side" data-win={win ? "true" : "false"}>
      <span>{side.character} · {side.name}</span>
      <LevelBadge level={side.level} />
      <span className="mono"><b>{side.percent.total}</b> / {side.target}</span>
    </div>
  );
}

/** 대항 판정: 두 굴림을 나란히, 이긴 쪽에 표시하고 결과 문장을 붙인다. */
function OpposedResult({ o }: { o: Extract<RollOutcome, { kind: "opposed" }> }) {
  return (
    <div className="opp" data-testid="opposed-result" data-winner={o.winner}>
      <SideLine side={o.a} win={o.winner === "a"} />
      <SideLine side={o.b} win={o.winner === "b"} />
      <div className={`res-sub${o.winner === "tie" || o.statusQuo ? " warn" : ""}`} data-testid="opposed-summary">{o.summary}</div>
    </div>
  );
}

/** 그룹 판정: 캐릭터마다 한 줄, 맨 아래에 요약. */
function GroupResult({ o }: { o: Extract<RollOutcome, { kind: "group" }> }) {
  return (
    <div className="opp" data-testid="group-result">
      {o.entries.map((e) => (
        <div key={e.characterId} className="opp-side" data-testid="group-entry" data-success={e.success ? "true" : "false"}>
          <span>{e.character}</span>
          <LevelBadge level={e.level} />
          <span className="mono"><b>{e.percent.total}</b> / {e.target}</span>
          <span className="res-sub">{e.success ? "성공" : "실패"}</span>
        </div>
      ))}
      <div className="res-sub" data-testid="group-summary">{o.summary}</div>
    </div>
  );
}

/** 굴림 결과를 성공 단계(색+글자), 목표값·굴림값·주사위 내역으로 풀어 보여 준다. */
export function RollResult({ outcome: o }: { outcome: RollOutcome }) {
  if (o.kind === "cc") return <CcResult o={o} />;
  if (o.kind === "san") return <SanResult o={o} />;
  if (o.kind === "dice") return <DiceResult o={o} />;
  if (o.kind === "opposed") return <OpposedResult o={o} />;
  if (o.kind === "group") return <GroupResult o={o} />;
  return <div className="mono">{describeOutcome(o)}</div>;
}
