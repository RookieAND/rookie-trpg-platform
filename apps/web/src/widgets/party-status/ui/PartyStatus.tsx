"use client";
import type { PartyStatus as Status } from "@coc-vtt/shared";

export interface PartyStatusProps {
  party: readonly Status[];
  meId: string;
}

const pct = (v: number, max: number) => (max > 0 ? Math.max(0, Math.min(100, Math.round((v / max) * 100))) : 0);

/** 보드 왼쪽 위에 겹쳐 두는 파티 상태판: 내 캐릭터가 맨 위, 다른 PL이 그 아래. HP·MP·SAN·행운을 한눈에 본다. */
export function PartyStatus({ party, meId }: PartyStatusProps) {
  if (party.length === 0) return null;
  const sorted = [...party].sort((a, b) => Number(b.ownerId === meId) - Number(a.ownerId === meId));
  return (
    <section className="party" aria-label="파티 상태" data-testid="party-status">
      {sorted.map((p) => (
        <div key={p.characterId} className={`party-card${p.ownerId === meId ? " mine" : ""}`} data-testid="party-card" data-mine={p.ownerId === meId ? "1" : "0"}>
          <div className="party-name">{p.name}</div>
          <Stat label="HP" cls="hp" v={p.hp} max={p.maxHp} />
          <Stat label="MP" cls="mp" v={p.mp} max={p.maxMp} />
          <Stat label="SAN" cls="san" v={p.san} max={99} />
          <div className="party-luck"><span>행운</span><b className="mono" data-testid="party-luck">{p.luck}</b></div>
        </div>
      ))}
    </section>
  );
}

function Stat({ label, cls, v, max }: { label: string; cls: string; v: number; max: number }) {
  return (
    <div className={`party-stat ${cls}`} role="meter" aria-label={label} aria-valuenow={v} aria-valuemin={0} aria-valuemax={max}>
      <span className="party-lab">{label}</span>
      <span className="party-bar"><i style={{ width: `${pct(v, max)}%` }} /></span>
      <b className="mono" data-testid={`party-${cls}`}>{v}<small>/{max}</small></b>
    </div>
  );
}
