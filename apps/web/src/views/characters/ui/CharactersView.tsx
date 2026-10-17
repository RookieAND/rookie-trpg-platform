"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { CharacterInput } from "@coc-vtt/shared";
import { createCharacter, deleteCharacter, listCharacters, updateCharacter, type VaultCharacter } from "@/entities/character";
import { useIdentity, type Identity } from "@/entities/user";
import { CharacterForm, CharacterWizard } from "@/features/edit-character";
import { OccupationManager, useOccupations } from "@/features/manage-occupations";
import { ApiError } from "@/shared/api";

export function CharactersView() {
  const router = useRouter();
  const { identity } = useIdentity();
  useEffect(() => {
    if (identity === null) router.replace("/");
  }, [identity, router]);
  if (!identity) return null;
  return <Vault me={identity} />;
}

type Editing = { mode: "new" } | { mode: "wizard" } | { mode: "edit"; character: VaultCharacter } | null;

function Vault({ me }: { me: Identity }) {
  const [items, setItems] = useState<VaultCharacter[] | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [error, setError] = useState<string | null>(null);
  const jobs = useOccupations(me);

  const refresh = useCallback(() => {
    listCharacters(me).then(setItems).catch(() => setError("서버에 연결하지 못했어요."));
  }, [me]);
  useEffect(refresh, [refresh]);

  const save = async (data: CharacterInput) => {
    try {
      if (editing?.mode === "edit") await updateCharacter(me, editing.character.id, data);
      else await createCharacter(me, data);
      setEditing(null);
      setError(null);
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "저장하지 못했어요.");
    }
  };

  const remove = async (c: VaultCharacter) => {
    if (!window.confirm(`'${c.name}'을(를) 지울까요? 되돌릴 수 없어요.`)) return;
    try {
      await deleteCharacter(me, c.id);
      refresh();
    } catch {
      setError("지우지 못했어요.");
    }
  };

  return (
    <div style={{ minHeight: "100vh" }}>
      <header className="topbar">
        <strong>[서비스 이름]</strong>
        <Link href="/" style={{ color: "var(--muted)", textDecoration: "none" }}>← 로비</Link>
        <div style={{ flex: 1 }} />
        <span className="badge">{me.name}</span>
      </header>
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "28px 24px", display: "grid", gap: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>내 캐릭터</h1>
          <div style={{ flex: 1 }} />
          {!editing && <button className="btn" onClick={() => setEditing({ mode: "wizard" })}>마법사로 만들기</button>}
          {!editing && <button className="btn primary" onClick={() => setEditing({ mode: "new" })}>새 캐릭터</button>}
        </div>
        {error && <div className="err" role="alert">{error}</div>}

        {editing?.mode === "wizard" && <CharacterWizard occupations={jobs.occupations} onSubmit={save} onCancel={() => setEditing(null)} />}
        {editing && editing.mode !== "wizard" && (
          <CharacterForm
            initial={editing.mode === "edit" ? { ...editing.character } : undefined}
            onSubmit={save}
            onCancel={() => setEditing(null)}
          />
        )}

        {!editing && <OccupationManager error={jobs.error} occupations={jobs.occupations} onAdd={jobs.add} onEdit={jobs.edit} onRemove={jobs.remove} exportText={jobs.exportText} importText={jobs.importText} />}

        {items && items.length === 0 && !editing && <div style={{ color: "var(--muted)" }}>아직 캐릭터가 없어요. 새 캐릭터를 만들어 보세요.</div>}
        {!editing &&
          items?.map((c) => (
            <article key={c.id} className="card" data-testid="vault-card" style={{ flexDirection: "row", alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{c.name}</div>
                <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{c.occupation || "직업 없음"} · {c.age}세 · 기능 {c.skills.length}개</div>
              </div>
              <button className="btn" onClick={() => setEditing({ mode: "edit", character: c })}>편집</button>
              <button className="btn danger" onClick={() => remove(c)}>삭제</button>
            </article>
          ))}
      </main>
    </div>
  );
}
