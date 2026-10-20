"use client";
import { useState } from "react";
import { UserPlus } from "lucide-react";
import { createPortal } from "react-dom";
import { LIMITS, MAX_CHARACTERS, NPC_PRESETS, QUICK_NPC_HP_MAX, buildQuickNpc, josa, quickNpcPreview, type CharacterData, type QuickNpc } from "@coc-vtt/shared";
import { Dialog, LimitNote, Select } from "@/shared/ui";

const WEAPON_SKILLS = ["맨손 격투", "사격(권총)", "사격(소총/산탄총)", "투척"] as const;

const blank: Omit<QuickNpc, "name"> = { hp: 10, str: 50, siz: 60, dex: 50, fight: 40, weaponName: "", weaponSkill: "맨손 격투", weaponDamage: "1d3+db", armor: 0, label: "" };

/**
 * GM의 "NPC 만들기": 이름과 몇 가지 숫자(또는 예시)로 NPC 시트를 룸에 바로 만든다.
 * 만들면 이 룸의 NPC 시트가 되고(PL에게는 보이지 않아요), "토큰도 같이 놓기"를 켜 두면 시트를 이은 토큰도 놓는다.
 */
export function NpcSheetButton({ count, disabled, onCreate, open: openProp, onOpenChange }: { count: number; disabled?: boolean; onCreate: (data: CharacterData, placeToken: boolean) => void; /** 밖에서 창을 열고 닫을 때(명령어 검색이 연다) */ open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (o: boolean) => (onOpenChange ? onOpenChange(o) : setOpenState(o));
  const [name, setName] = useState("");
  const [v, setV] = useState(blank);
  const [preset, setPreset] = useState("");
  const [place, setPlace] = useState(true);
  const full = count >= MAX_CHARACTERS;

  const num = (key: "hp" | "str" | "siz" | "dex" | "fight" | "dodge" | "armor") => (
    <input
      className="input mono"
      type="number"
      inputMode="numeric"
      value={v[key] ?? ""}
      min={0}
      max={key === "hp" ? QUICK_NPC_HP_MAX : 100}
      onChange={(e) => setV({ ...v, [key]: e.target.value === "" ? undefined : Number(e.target.value) } as typeof v)}
      aria-label={LABEL[key]}
      data-testid={`npc-${key}`}
    />
  );
  const choose = (id: string) => {
    setPreset(id);
    const p = NPC_PRESETS.find((x) => x.id === id);
    if (p) {
      setV({ ...blank, ...p.values, weaponSkill: p.values.weaponSkill ?? "맨손 격투" });
      setName((cur) => cur || p.label);
    }
  };
  const close = () => {
    setOpen(false);
    setName("");
    setPreset("");
    setV(blank);
  };
  const db = quickNpcPreview({ str: v.str, siz: v.siz, hp: v.hp });
  const valid = name.trim().length > 0 && Number.isFinite(v.hp);

  return (
    <>
      <button className="btn" data-testid="npc-new" disabled={disabled || full} title={full ? `시트는 ${MAX_CHARACTERS}개까지예요` : "이름과 몇 가지 숫자로 NPC 시트를 만들어요"} onClick={() => setOpen(true)}><UserPlus aria-hidden />NPC 만들기</button>
      {open &&
        createPortal(
          <Dialog
            label="NPC 만들기"
            onClose={close}
            data-testid="npc-dialog"
            style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,.5)", display: "grid", placeItems: "center", padding: 16 }}
            onClick={(e) => e.target === e.currentTarget && close()}
          >
            <form
              className="card import-card"
              onSubmit={(e) => {
                e.preventDefault();
                if (!valid) return;
                onCreate(buildQuickNpc({ name, ...v, weaponName: v.weaponName?.trim() || undefined }), place);
                close();
              }}
            >
              <strong>NPC 만들기</strong>
              <span className="import-sub">빈칸만 채우면 돼요. 나머지 기능은 기본값으로 들어가고, 만든 뒤 시트에서 고칠 수 있어요.</span>
              <label className="npc-field">이름<input className="input" aria-label="NPC 이름" data-testid="npc-name" value={name} maxLength={LIMITS.objectName} onChange={(e) => setName(e.target.value)} autoFocus /><LimitNote label="이름" max={LIMITS.objectName} value={name} /></label>
              <label className="npc-field">예시
                <Select className="input" aria-label="빠른 NPC 예시" data-testid="npc-preset" value={preset} onChange={(e) => choose(e.target.value)}>
                  <option value="">직접 입력</option>
                  {NPC_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </Select>
              </label>
              <div className="npc-grid">
                <label className="npc-field">HP{num("hp")}</label>
                <label className="npc-field">DEX{num("dex")}</label>
                <label className="npc-field">STR{num("str")}</label>
                <label className="npc-field">SIZ{num("siz")}</label>
                <label className="npc-field">회피{num("dodge")}</label>
                <label className="npc-field">방어구{num("armor")}</label>
              </div>
              <div className="import-sub" data-testid="npc-db">피해 보너스 {db.damageBonus} · 체격 {db.build}</div>
              <div className="npc-grid">
                <label className="npc-field">무기<input className="input" aria-label="무기 이름" data-testid="npc-weapon" value={v.weaponName ?? ""} maxLength={30} placeholder="없으면 비워요" onChange={(e) => setV({ ...v, weaponName: e.target.value })} /></label>
                <label className="npc-field">무기 기능
                  <Select className="input" aria-label="무기 기능" value={v.weaponSkill} onChange={(e) => setV({ ...v, weaponSkill: e.target.value })}>
                    {WEAPON_SKILLS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select>
                </label>
                <label className="npc-field">기능 값{num("fight")}</label>
                <label className="npc-field">피해<input className="input mono" aria-label="무기 피해" value={v.weaponDamage ?? ""} maxLength={40} placeholder="1d6+db" onChange={(e) => setV({ ...v, weaponDamage: e.target.value })} /></label>
              </div>
              <label className="check"><input type="checkbox" data-testid="npc-place" checked={place} onChange={(e) => setPlace(e.target.checked)} style={{ accentColor: "#7c86f7" }} /> 토큰도 같이 놓기</label>
              {!valid && <div className="why" id="npc-why" data-testid="npc-why">{name.trim() ? "HP를 숫자로 적어 주세요." : "이름을 적으면 만들 수 있어요."}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="btn" onClick={close}>취소</button>
                <button type="submit" className="btn primary" data-testid="npc-create" disabled={!valid} aria-describedby={valid ? undefined : "npc-why"}>{name.trim() ? `${josa(`'${name.trim()}'`, "을/를")} 만들기` : "만들기"}</button>
              </div>
            </form>
          </Dialog>,
          document.body,
        )}
    </>
  );
}

const LABEL: Record<string, string> = { hp: "HP", str: "STR", siz: "SIZ", dex: "DEX", fight: "무기 기능 값", dodge: "회피", armor: "방어구" };
