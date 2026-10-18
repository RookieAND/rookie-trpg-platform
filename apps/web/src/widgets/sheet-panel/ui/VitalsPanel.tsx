"use client";
import { useState } from "react";
import { CONDITIONS, CONDITION_LABEL_KO, statusKeys, type Character, type HealKind, type SheetOp } from "@coc-vtt/shared";
import { Hint, StatusChips } from "@/shared/ui";
import { woundHint, woundThreshold } from "../model/wound-hint";

interface Props {
  c: Character;
  maxHp: number;
  isKp: boolean;
  canEdit: boolean;
  canAct: boolean;
  onPatch: (characterId: string, ops: SheetOp[]) => void;
  /** 건강 판정(CON) 빠른 굴림 */
  onConRoll: () => void;
  onApplyDamage?: (characterId: string, amount: number, armor: number) => void;
  onHeal?: (characterId: string, kind: HealKind, amount?: number) => void;
}

const toInt = (v: string): number | null => (/^\d{1,3}$/.test(v.trim()) ? Number(v.trim()) : null);

/** 부상 상태 칩, 중상·빈사 안내, 건강 판정(CON) 빠른 굴림. GM에게는 상태 표시 토글과 피해·회복 입력이 더 보인다. */
export function VitalsPanel({ c, maxHp, isKp, canEdit, canAct, onPatch, onConRoll, onApplyDamage, onHeal }: Props) {
  const [amount, setAmount] = useState("");
  const [armor, setArmor] = useState("0");
  const [heal, setHeal] = useState("");
  const keys = statusKeys(c);
  const hint = woundHint(c, maxHp);
  const dead = c.conditions?.includes("dead") ?? false;
  const showCon = !dead && (c.conditions?.includes("majorWound") || c.conditions?.includes("dying"));
  const dmg = toInt(amount);
  const arm = toInt(armor);
  const healN = toInt(heal);

  return (
    <div className="sheet-sec" data-testid="vitals">
      <div className="row" data-testid="sheet-status">
        {keys.length > 0 ? <StatusChips keys={keys} /> : <span className="res-sub">상태 이상 없음</span>}
        <Hint term="condition" />
        {showCon && (
          <button className="btn sm" data-testid="con-roll" disabled={!canAct} onClick={onConRoll} title="CON으로 굴려요. 중상을 입었거나 빈사면 건강 판정을 해요">
            건강 판정(CON)
          </button>
        )}
      </div>
      <div className="res-sub" data-testid="wound-threshold">중상 기준: 한 번에 {woundThreshold(maxHp)} 이상 피해 · 즉사 기준: 한 번에 {maxHp} 이상</div>
      {hint && (
        <div className={`wound-hint${hint.danger ? " danger" : ""}`} data-testid="wound-hint" role="status">
          {hint.text}
        </div>
      )}

      {isKp && (
        <>
          <div className="row" data-testid="conditions">
            {CONDITIONS.map((k) => {
              const on = c.conditions?.includes(k) ?? false;
              return (
                <button key={k} className={`btn sm${on ? " on-danger" : ""}`} aria-pressed={on} disabled={!canEdit} onClick={() => onPatch(c.id, [{ path: "condition", name: k, on: !on }])}>
                  {CONDITION_LABEL_KO[k]}
                </button>
              );
            })}
          </div>
          {(onApplyDamage || onHeal) && (
            <div className="vitals" data-testid="gm-vitals">
              {onApplyDamage && (
                <div className="row">
                  <input className="input mono" inputMode="numeric" aria-label="적용할 피해" placeholder="피해" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  <input className="input mono" inputMode="numeric" aria-label="방어구" placeholder="방어구" title="피해에서 뺄 방어구 값" value={armor} onChange={(e) => setArmor(e.target.value)} />
                  <button
                    className="btn sm"
                    data-testid="sheet-apply-damage"
                    disabled={!canEdit || dmg === null || arm === null || dead}
                    onClick={() => {
                      if (dmg === null || arm === null) return;
                      onApplyDamage(c.id, dmg, arm);
                      setAmount("");
                    }}
                  >
                    피해 적용
                  </button>
                </div>
              )}
              {onHeal && (
                <div className="row">
                  <button className="btn sm" data-testid="heal-firstaid" disabled={!canEdit || dead} title="HP를 1 올려요. 빈사면 풀려요" onClick={() => onHeal(c.id, "firstAid")}>응급처치 +1</button>
                  <button className="btn sm" data-testid="heal-natural" disabled={!canEdit || dead} title="하루 쉬어서 HP를 1 올려요" onClick={() => onHeal(c.id, "natural", 1)}>자연 회복 +1</button>
                  <input className="input mono" inputMode="numeric" aria-label="회복량" placeholder="회복량" value={heal} onChange={(e) => setHeal(e.target.value)} />
                  <button
                    className="btn sm"
                    data-testid="heal-manual"
                    disabled={!canEdit || dead || healN === null || healN < 1}
                    onClick={() => {
                      if (healN === null || healN < 1) return;
                      onHeal(c.id, "manual", healN);
                      setHeal("");
                    }}
                  >
                    회복
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
