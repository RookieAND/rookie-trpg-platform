"use client";
import { useState } from "react";
import { Dices } from "lucide-react";
import { EFFECT_LEVELS, LEVEL_LABEL_KO, type ClientCommand, type EffectLevel, type EffectSettings } from "@coc-vtt/shared";
import { Dialog, Select } from "@/shared/ui";

/** GM이 판정 단계별 효과를 켜고 세기를 정한다. 참가자는 개인 설정으로 끌 수 있다. */
export function EffectSettingsButton({ effects, send }: { effects: EffectSettings; send: (c: ClientCommand) => unknown }) {
  const [open, setOpen] = useState(false);
  const set = (level: EffectLevel, patch: { enabled?: boolean; intensity?: 1 | 2 | 3 }) => send({ type: "settings.effects", data: { level, ...patch } });

  return (
    <>
      <button className="btn" onClick={() => setOpen(!open)} aria-expanded={open}><Dices aria-hidden />판정 효과</button>
      {open && (
        <Dialog label="판정 효과 설정" onClose={() => setOpen(false)} className="dialog">
          <strong>판정 효과</strong>
          <span style={{ color: "var(--muted)", fontSize: 12.5 }}>켠 단계는 굴림 결과가 나올 때 모두의 화면에 효과가 재생돼요. 참가자는 각자 끌 수 있어요.</span>
          {EFFECT_LEVELS.map((level) => (
            <div key={level} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={effects[level].enabled} onChange={(e) => set(level, { enabled: e.target.checked })} style={{ accentColor: "#7c86f7" }} />
                {LEVEL_LABEL_KO[level]}
              </label>
              <Select className="input" style={{ width: 96, height: 30 }} aria-label={`${LEVEL_LABEL_KO[level]} 세기`} value={effects[level].intensity} disabled={!effects[level].enabled} onChange={(e) => set(level, { intensity: Number(e.target.value) as 1 | 2 | 3 })}>
                <option value={1}>약하게</option>
                <option value={2}>보통</option>
                <option value={3}>강하게</option>
              </Select>
            </div>
          ))}
          <div style={{ textAlign: "right" }}><button className="btn" onClick={() => setOpen(false)}>닫기</button></div>
        </Dialog>
      )}
    </>
  );
}
