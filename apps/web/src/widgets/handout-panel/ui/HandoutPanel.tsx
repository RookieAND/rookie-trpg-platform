"use client";
import { useState } from "react";
import type { ClientCommand, Handout, Member } from "@coc-vtt/shared";
import { HandoutEditor } from "@/features/manage-handouts";
import { imageUrl, type Caller } from "@/shared/api";

type Editing = { mode: "new" } | { mode: "edit"; handout: Handout } | null;

const scope = (h: Handout, players: Member[]) =>
  h.kpOnly ? "KP 노트" : h.visibleTo === "gm" ? "초안" : h.visibleTo === "all" ? "전원" : h.visibleTo.map((id) => players.find((p) => p.userId === id)?.name ?? "?").join(", ");

/** 핸드아웃 목록. KP는 만들고 고치고 공개 범위를 정하고, 나머지는 받은 것만 읽는다. */
export function HandoutPanel({ me, handouts, isKp, canEdit, canShow = canEdit, players, send }: { me: Caller; handouts: Handout[]; isKp: boolean; canEdit: boolean; canShow?: boolean; players: Member[]; send: (c: ClientCommand) => unknown }) {
  const [editing, setEditing] = useState<Editing>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div style={{ overflow: "auto", padding: 16, display: "grid", gap: 12, alignContent: "start", flex: 1 }} data-testid="handouts">
      {isKp && !editing && <button className="btn primary" disabled={!canEdit} onClick={() => setEditing({ mode: "new" })}>새 핸드아웃</button>}

      {editing && (
        <HandoutEditor
          me={me}
          initial={editing.mode === "edit" ? { ...editing.handout, image: editing.handout.image ?? null } : undefined}
          players={players.filter((m) => m.role === "pl")}
          onCancel={() => setEditing(null)}
          onSave={(d) => {
            const ok = editing.mode === "edit"
              ? send({ type: "handout.update", data: { id: editing.handout.id, ...d } })
              : send({ type: "handout.create", data: { title: d.title, body: d.body, visibleTo: d.visibleTo, ...(d.kpOnly ? { kpOnly: true } : {}), ...(d.image ? { image: d.image } : {}) } });
            if (ok !== false) setEditing(null); // 보내지 못했으면 편집 창을 닫지 않는다
          }}
        />
      )}

      {handouts.length === 0 && !editing && (
        <div style={{ color: "var(--muted)" }}>{isKp ? "아직 핸드아웃이 없어요. 새로 만들어 PL에게 보여 주세요." : "아직 받은 핸드아웃이 없어요."}</div>
      )}

      {!editing &&
        handouts.map((h) => (
          <article key={h.id} className="card" data-testid="handout-item" style={{ gap: 8 }}>
            <button style={{ all: "unset", cursor: "pointer", display: "flex", gap: 8, alignItems: "center" }} aria-expanded={openId === h.id} onClick={() => setOpenId(openId === h.id ? null : h.id)}>
              <strong style={{ flex: 1 }}>{h.title}</strong>
              {isKp && <span className={`badge ${h.kpOnly ? "kp" : h.visibleTo === "gm" ? "paused" : ""}`}>{scope(h, players)}</span>}
            </button>
            {openId === h.id && (
              <div style={{ display: "grid", gap: 8 }}>
                {h.image && <img src={imageUrl(h.image)} alt={`${h.title} 이미지`} style={{ maxWidth: "100%", borderRadius: 6 }} />}
                <div style={{ whiteSpace: "pre-wrap" }}>{h.body || <span style={{ color: "var(--muted)" }}>내용이 없어요.</span>}</div>
              </div>
            )}
            {isKp && (
              <div className="btn-row">
                {!h.kpOnly && <button className="btn" disabled={!canShow || h.visibleTo === "gm"} title={h.kpOnly ? "KP 전용 노트는 펼쳐 보일 수 없어요" : undefined} onClick={() => send({ type: "handout.show", data: { id: h.id } })}>펼쳐 보이기</button>}
                <button className="btn" disabled={!canEdit} onClick={() => setEditing({ mode: "edit", handout: h })}>편집</button>
                <button className="btn danger" disabled={!canEdit} onClick={() => window.confirm(`'${h.title}'을(를) 지울까요?`) && send({ type: "handout.remove", data: { id: h.id } })}>삭제</button>
              </div>
            )}
          </article>
        ))}
    </div>
  );
}
