"use client";
import { deriveCharacter, type Character, type Member } from "@coc-vtt/shared";

/** 시트 목록: 인물만 나열한다. 카드를 누르면 시트가 대화상자로 열린다(자세한 수치는 거기서 본다). */
export function SheetList({ characters, npcIds, members, selectedId, onOpen }: { characters: readonly Character[]; npcIds?: ReadonlySet<string>; members: readonly Member[]; selectedId: string | null; onOpen: (id: string) => void }) {
  const pcs = characters.filter((c) => !npcIds?.has(c.id));
  const npcs = characters.filter((c) => npcIds?.has(c.id));
  const group = (title: string | null, list: readonly Character[], testId: string) =>
    list.length === 0 ? null : (
      <section className="sl-group" data-testid={testId}>
        {title && <h3 className="sl-title">{title} <span className="muted">{list.length}</span></h3>}
        <ul className="sl-list">
          {list.map((c) => {
            const d = deriveCharacter(c);
            const owner = members.find((m) => m.userId === c.ownerId && m.role === "pl")?.name;
            return (
              <li key={c.id}>
                <button type="button" className={`sl-card${c.id === selectedId ? " on" : ""}`} data-testid="sheet-card" data-name={c.name} aria-haspopup="dialog" onClick={() => onOpen(c.id)}>
                  <span className="sl-avatar" aria-hidden>{[...c.name][0] ?? "?"}</span>
                  <span className="sl-main">
                    <b className="sl-name">{c.name}</b>
                    <span className="sl-sub">{[c.occupation || "직업 없음", `${c.age}세`, owner].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="sl-vit" aria-label={`HP ${c.hp}/${d.limits.hp}, SAN ${c.san}`}>
                    <span>HP {c.hp}<i>/{d.limits.hp}</i></span>
                    <span>SAN {c.san}</span>
                  </span>
                  {c.madness && c.madness !== "none" && <span className="badge paused">광기</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    );
  return (
    <div className="sheet-cards" data-testid="sheet-list">
      {npcs.length > 0 && pcs.length > 0 ? (
        <>
          {group("PL 시트", pcs, "sheet-group-pl")}
          {group("NPC 시트 (PL에게 안 보여요)", npcs, "sheet-group-npc")}
        </>
      ) : (
        group(null, characters, "sheet-group-all")
      )}
    </div>
  );
}
