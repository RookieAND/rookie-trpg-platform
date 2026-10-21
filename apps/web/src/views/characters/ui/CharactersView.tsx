"use client";
import Link from "next/link";
import { Download, Pencil, Plus, Trash2, WandSparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { CharacterInput } from "@coc-vtt/shared";
import { SheetCsvImport, createCharacter, deleteCharacter, downloadCharacterCsv, listCharacters, updateCharacter, type VaultCharacter } from "@/entities/character";
import { useIdentity, type Identity } from "@/entities/user";
import { CharacterForm } from "@/features/edit-character";
import { OccupationManager, useOccupations } from "@/features/manage-occupations";
import { CharacterCreator } from "@/widgets/character-creator";
import { ApiError } from "@/shared/api";
import { SERVICE_NAME } from "@/shared/config";
import { useAsk } from "@/shared/ui";
import { josa } from "@coc-vtt/shared";

export function CharactersView() {
  const router = useRouter();
  const { identity } = useIdentity();
  useEffect(() => {
    if (identity === null) router.replace("/");
  }, [identity, router]);
  if (!identity) return null;
  return <Vault me={identity} />;
}

type Editing = { mode: "new"; initial?: CharacterInput } | { mode: "wizard" } | { mode: "edit"; character: VaultCharacter } | null;

function Vault({ me }: { me: Identity }) {
  const ask = useAsk();
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
    if (!(await ask.confirm({ title: `${josa(`'${c.name}'`, "을/를")} 지울까요?`, message: "되돌릴 수 없어요.", confirmLabel: "지우기", danger: true }))) return;
    try {
      await deleteCharacter(me, c.id);
      refresh();
    } catch {
      setError("지우지 못했어요.");
    }
  };

  return (
    <div style={{ minHeight: "100vh" }}>
      {ask.node}
      <header className="topbar">
        <strong>{SERVICE_NAME}</strong>
        <Link href="/" style={{ color: "var(--muted)", textDecoration: "none" }}>← 로비</Link>
        <div style={{ flex: 1 }} />
        <span className="badge">{me.name}</span>
      </header>
      <main className="vault-main" style={{ maxWidth: 760, margin: "0 auto", padding: "28px 24px", display: "grid", gap: 20 }}>
        <div className="vault-head" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>내 캐릭터</h1>
          <div style={{ flex: 1 }} />
          {!editing && <button className="btn" onClick={() => setEditing({ mode: "wizard" })}><WandSparkles aria-hidden />마법사로 만들기</button>}
          {!editing && <button className="btn primary" onClick={() => setEditing({ mode: "new" })}><Plus aria-hidden />새 캐릭터</button>}
        </div>
        {!editing && (
          <SheetCsvImport me={me} applyLabel="새 캐릭터 폼으로 열기" onApply={(data) => { setError(null); setEditing({ mode: "new", initial: data }); }} />
        )}
        {error && <div className="err" role="alert">{error}</div>}

        {editing?.mode === "wizard" && <CharacterCreator me={me} onCreated={() => { setEditing(null); setError(null); refresh(); }} onCancel={() => setEditing(null)} />}
        {editing && editing.mode !== "wizard" && (
          <CharacterForm
            me={me}
            initial={editing.mode === "edit" ? { ...editing.character } : editing.initial}
            onSubmit={save}
            onCancel={() => setEditing(null)}
          />
        )}

        {!editing && <OccupationManager error={jobs.error} occupations={jobs.occupations} onAdd={jobs.add} onEdit={jobs.edit} onRemove={jobs.remove} exportText={jobs.exportText} importText={jobs.importText} />}

        {items && items.length === 0 && !editing && <div style={{ color: "var(--muted)" }}>아직 캐릭터가 없어요. 새 캐릭터를 만들어 보세요.</div>}
        {!editing &&
          items?.map((c) => (
            <article key={c.id} className="card vault-card" data-testid="vault-card" style={{ flexDirection: "row", alignItems: "center" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{c.name}</div>
                <div style={{ color: "var(--muted)", fontSize: 12.5 }}>{c.occupation || "직업 없음"} · {c.age}세 · 기능 {c.skills.length}개</div>
              </div>
              <button className="btn" onClick={() => setEditing({ mode: "edit", character: c })}><Pencil aria-hidden />편집</button>
              <button className="btn" aria-label={`${c.name} CSV로 내보내기`} onClick={() => downloadCharacterCsv(c)}><Download aria-hidden />CSV</button>
              <button className="btn ico danger" aria-label={`${c.name} 삭제`} title="삭제" onClick={() => remove(c)}><Trash2 aria-hidden /></button>
            </article>
          ))}
      </main>
    </div>
  );
}
