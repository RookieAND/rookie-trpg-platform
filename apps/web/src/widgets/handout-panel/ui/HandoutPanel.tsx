"use client";
import { useState } from "react";
import type { ClientCommand, Handout, Member } from "@coc-vtt/shared";
import { HandoutEditor } from "@/features/manage-handouts";
import { showBlockReason } from "../model/show-reason";
import { imageUrl, type Caller } from "@/shared/api";
import { useAsk } from "@/shared/ui";
import { josa } from "@coc-vtt/shared";

type Editing = { mode: "new" } | { mode: "edit"; handout: Handout } | null;

/** 이전에 가져온 노트 제목에 남은 `[KP]` 머리말은 보여 주지 않는다. */
const shownTitle = (h: Pick<Handout, "title" | "kpOnly">) => (h.kpOnly ? h.title.replace(/^\[(?:KP|GM)\]\s*/i, "") || h.title : h.title);

const scope = (h: Handout, players: Member[]) =>
  h.kpOnly ? "GM 노트" : h.visibleTo === "gm" ? "초안" : h.visibleTo === "all" ? "전원" : h.visibleTo.map((id) => players.find((p) => p.userId === id)?.name ?? "?").join(", ");

/** 핸드아웃 목록. GM은 만들고 고치고 공개 범위를 정하고, 나머지는 받은 것만 읽는다. */
export function HandoutPanel({ me, handouts, isKp, canEdit, canShow = canEdit, players, send }: { me: Caller; handouts: Handout[]; isKp: boolean; canEdit: boolean; canShow?: boolean; players: Member[]; send: (c: ClientCommand) => unknown }) {
  const ask = useAsk();
  const [editing, setEditing] = useState<Editing>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="panel" data-testid="handouts">
      {ask.node}
      {!editing && (
        <div className="panel-head">
          <span className="section-title">핸드아웃 {handouts.length}</span>
          {isKp && <button className="btn sm primary" disabled={!canEdit} onClick={() => setEditing({ mode: "new" })}>새 핸드아웃</button>}
        </div>
      )}

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
              <strong style={{ flex: 1 }}>{shownTitle(h)}</strong>
              {isKp && <span className={`badge ${h.kpOnly ? "kp" : h.visibleTo === "gm" ? "paused" : ""}`}>{scope(h, players)}</span>}
            </button>
            {openId === h.id && (
              <div style={{ display: "grid", gap: 8 }}>
                {h.image && <img src={imageUrl(h.image)} alt={`${shownTitle(h)} 이미지`} style={{ maxWidth: "100%", borderRadius: 6 }} />}
                <div style={{ whiteSpace: "pre-wrap" }}>{h.body || <span style={{ color: "var(--muted)" }}>내용이 없어요.</span>}</div>
              </div>
            )}
            {isKp && !h.kpOnly && showBlockReason(h, canShow) && (
              <div className="why" id={`handout-why-${h.id}`} data-testid="handout-show-why">{showBlockReason(h, canShow)}</div>
            )}
            {isKp && (
              <div className="btn-row">
                {!h.kpOnly && h.visibleTo === "gm" && (
                  <button className="btn primary" disabled={!canShow} data-testid="handout-publish" title="모두에게 공개하고 바로 펼쳐 보여요" aria-describedby={canShow ? undefined : `handout-why-${h.id}`}
                    onClick={() => send({ type: "handout.show", data: { id: h.id, reveal: true } })}>공개하기</button>
                )}
                {!h.kpOnly && <button className="btn" disabled={!canShow || h.visibleTo === "gm"} aria-describedby={showBlockReason(h, canShow) ? `handout-why-${h.id}` : undefined} onClick={() => send({ type: "handout.show", data: { id: h.id } })}>펼쳐 보이기</button>}
                <button className="btn" disabled={!canEdit} onClick={() => setEditing({ mode: "edit", handout: h })}>편집</button>
                <button className="btn danger" disabled={!canEdit} onClick={async () => (await ask.confirm({ title: `${josa(`'${shownTitle(h)}'`, "을/를")} 지울까요?`, confirmLabel: "지우기", danger: true })) && send({ type: "handout.remove", data: { id: h.id } })}>삭제</button>
              </div>
            )}
          </article>
        ))}
    </div>
  );
}
