"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { ClientCommand } from "@coc-vtt/shared";
import { listCharacters, type VaultCharacter } from "@/entities/character";
import type { Identity } from "@/entities/user";

/** 보관함의 캐릭터를 이 룸으로 불러온다(복사본이 만들어진다). */
export function LoadCharacter({ me, send, disabled }: { me: Identity; send: (c: ClientCommand) => unknown; disabled?: boolean }) {
  const [items, setItems] = useState<VaultCharacter[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const reload = () => listCharacters(me).then((r) => (setItems(r), setFailed(false))).catch(() => setFailed(true));
    void reload();
    // 새 탭에서 캐릭터를 만들고 돌아오면 목록을 다시 불러온다.
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [me]);

  const load = (c: VaultCharacter) =>
    send({
      type: "character.add",
      data: {
        vaultId: c.id,
        name: c.name,
        age: c.age,
        occupation: c.occupation,
        characteristics: c.characteristics,
        luck: c.luck,
        hp: c.hp,
        mp: c.mp,
        san: c.san,
        skills: c.skills,
        notes: c.notes,
        backstory: c.backstory ?? "",
        possessions: c.possessions ?? "",
        weapons: c.weapons ?? [],
      },
    });

  if (failed) return <div className="err" role="alert">보관함을 불러오지 못했어요.</div>;
  if (!items) return <div style={{ color: "var(--muted)" }}>불러오는 중이에요…</div>;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <strong>내 캐릭터 불러오기</strong>
      {items.length === 0 && (
        <div style={{ color: "var(--muted)" }}>
          보관함이 비어 있어요. <Link href="/characters" target="_blank" rel="noopener" style={{ color: "var(--accent)" }}>새 탭에서 캐릭터 만들기</Link>, 만든 뒤 이 화면으로 돌아와요
        </div>
      )}
      {items.map((c) => (
        <div key={c.id} style={{ display: "flex", gap: 8, alignItems: "center" }} data-testid="vault-item">
          <span style={{ flex: 1 }}>{c.name}<span style={{ color: "var(--muted)" }}> · {c.occupation || "직업 없음"}</span></span>
          <button className="btn" disabled={disabled} onClick={() => load(c)}>불러오기</button>
        </div>
      ))}
    </div>
  );
}
