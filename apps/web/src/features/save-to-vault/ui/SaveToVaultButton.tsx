"use client";
import { useState } from "react";
import type { Character } from "@coc-vtt/shared";
import { updateCharacter } from "@/entities/character";
import type { Identity } from "@/entities/user";

/** 세션이 끝난 뒤, 룸 안에서 바뀐 HP·SAN·기능·성장 표시를 보관함 원본에 반영한다. */
export function SaveToVaultButton({ me, character }: { me: Identity; character: Character }) {
  const [state, setState] = useState<"idle" | "saving" | "done" | "failed">("idle");
  if (!character.vaultId) return null;

  const save = async () => {
    setState("saving");
    try {
      await updateCharacter(me, character.vaultId!, {
        name: character.name,
        age: character.age,
        occupation: character.occupation,
        characteristics: character.characteristics,
        luck: character.luck,
        hp: character.hp,
        mp: character.mp,
        san: character.san,
        skills: Object.entries(character.skills).map(([name, s]) => ({ name, value: s.value, grown: s.grown })),
        notes: character.notes,
        backstory: character.backstory ?? "",
        possessions: character.possessions ?? "",
        weapons: character.weapons ?? [],
      });
      setState("done");
    } catch {
      setState("failed");
    }
  };

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <button className="btn primary" disabled={state === "saving" || state === "done"} onClick={save}>
        {state === "done" ? "보관함에 반영했어요" : "보관함에 반영"}
      </button>
      {state === "failed" && <div className="err" role="alert">반영하지 못했어요. 보관함에서 지워진 캐릭터일 수 있어요.</div>}
    </div>
  );
}
