"use client";
import { useState } from "react";
import { BEAT_KIND_LABEL_KO, type AudioTrack, type Beat, type Branch, type ClientCommand, type Flow, type Handout, type Scene } from "@coc-vtt/shared";
import { BeatEditor } from "./BeatEditor";
import { BranchEditor } from "./BranchEditor";

type Editing = { kind: "beat"; beat?: Beat } | { kind: "branch"; from: string; branch?: Branch } | null;

const conditionText = (b: Branch, handouts: Handout[]) => {
  const c = b.condition;
  if (c.type === "manual") return "수동";
  if (c.type === "roll") return `${c.skill} 판정 ${{ regular: "보통", hard: "어려움", extreme: "극단", critical: "대성공" }[c.atLeast]} 이상`;
  if (c.type === "stat") return `${c.stat.toUpperCase()} ${c.atMost} 이하`;
  return `핸드아웃 '${handouts.find((h) => h.id === c.handoutId)?.title ?? "?"}' 공개`;
};

/** KP의 세션 흐름: 비트(진행 단계)와 분기를 미리 짜 두고, 진행 중에는 현재 위치를 옮긴다. 참가자에게는 보이지 않는다. */
export function FlowPanel({ flow, scenes, handouts, tracks, status, enabled, send }: { flow: Flow; scenes: Scene[]; handouts: Handout[]; tracks: AudioTrack[]; status: string; enabled: boolean; send: (c: ClientCommand) => unknown }) {
  const [editing, setEditing] = useState<Editing>(null);
  const active = status === "ACTIVE";
  const beatName = (id: string) => flow.beats.find((b) => b.id === id)?.name ?? "?";
  const current = flow.beats.find((b) => b.id === flow.current);
  const outgoing = flow.branches.filter((b) => b.from === flow.current);
  const hasStart = flow.beats.some((b) => b.kind === "start");
  const hasEnding = flow.beats.some((b) => b.kind === "ending");

  if (editing?.kind === "beat") {
    return (
      <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
        <BeatEditor
          initial={editing.beat}
          scenes={scenes}
          handouts={handouts.filter((h) => !h.kpOnly)}
          tracks={tracks}
          onCancel={() => setEditing(null)}
          onSave={(d) => {
            if (send({ type: "flow.beat.upsert", data: d }) !== false) setEditing(null);
          }}
        />
      </div>
    );
  }
  if (editing?.kind === "branch") {
    return (
      <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
        <BranchEditor
          initial={editing.branch}
          fromId={editing.from}
          beats={flow.beats}
          handouts={handouts.filter((h) => !h.kpOnly)}
          onCancel={() => setEditing(null)}
          onSave={(d) => {
            if (send({ type: "flow.branch.upsert", data: d }) !== false) setEditing(null);
          }}
        />
      </div>
    );
  }

  return (
    <div style={{ padding: 16, display: "grid", gap: 12, alignContent: "start", overflow: "auto", flex: 1 }} data-testid="flow">
      {(!hasStart || !hasEnding) && (
        <div className="banner" role="status" data-testid="flow-warning">
          {!hasStart && "시작 비트가 없어요. "}
          {!hasEnding && "엔딩 비트가 없어요. "}
          없어도 세션은 시작하고 끝낼 수 있어요.
        </div>
      )}

      {flow.suggestions.map((s) => {
        const br = flow.branches.find((b) => b.id === s.branchId);
        if (!br) return null;
        return (
          <div key={s.branchId} className="card" data-testid="flow-suggestion" style={{ gap: 6, borderColor: "var(--accent)" }}>
            <strong>제안: {br.label} → {beatName(br.to)}</strong>
            <span style={{ color: "var(--muted)" }}>{s.reason}</span>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn primary" disabled={!enabled || !active} onClick={() => send(gotoCmd(flow, br.to))}>{flow.beats.find((b) => b.id === br.to)?.kind === "ending" ? "엔딩 확정" : "이동"}</button>
              <button className="btn" disabled={!enabled} onClick={() => send({ type: "flow.dismiss", data: { branchId: s.branchId } })}>넘기기</button>
            </div>
          </div>
        );
      })}

      {current && (
        <section className="card" data-testid="flow-current" style={{ gap: 6 }}>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>지금 비트</div>
          <strong>{current.name}</strong>
          {current.memo && <div style={{ whiteSpace: "pre-wrap", color: "var(--muted)" }}>{current.memo}</div>}
          {outgoing.length === 0 && <div style={{ color: "var(--muted)" }}>여기서 나가는 분기가 없어요.</div>}
          {outgoing.map((b) => (
            <div key={b.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ flex: 1 }}>
                {b.label} → {beatName(b.to)} <span style={{ color: "var(--muted)", fontSize: 12 }}>({conditionText(b, handouts)})</span>
              </span>
              <button className="btn" disabled={!enabled || !active} onClick={() => send(gotoCmd(flow, b.to))}>{flow.beats.find((x) => x.id === b.to)?.kind === "ending" ? "엔딩 확정" : "이동"}</button>
              <button className="btn" disabled={!enabled} onClick={() => setEditing({ kind: "branch", from: b.from, branch: b })}>편집</button>
              <button className="btn danger" aria-label={`${b.label} 분기 삭제`} disabled={!enabled} onClick={() => send({ type: "flow.branch.remove", data: { id: b.id } })}>삭제</button>
            </div>
          ))}
        </section>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <strong style={{ flex: 1 }}>비트 {flow.beats.length}개</strong>
        <button className="btn primary" disabled={!enabled} onClick={() => setEditing({ kind: "beat" })}>비트 추가</button>
      </div>
      {flow.beats.length === 0 && <div style={{ color: "var(--muted)" }}>아직 비트가 없어요. 시작 비트부터 만들어 보세요.</div>}

      {flow.beats.map((b) => {
        const isCurrent = b.id === flow.current;
        const branches = flow.branches.filter((x) => x.from === b.id);
        return (
          <article key={b.id} className="card" data-testid="beat-item" style={{ gap: 6, ...(isCurrent ? { borderColor: "var(--accent)" } : {}) }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <strong style={{ flex: 1 }}>{isCurrent ? "▶ " : ""}{b.name}</strong>
              <span className="badge">{BEAT_KIND_LABEL_KO[b.kind]}</span>
            </div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>
              {b.sceneId ? `장면 ${scenes.find((s) => s.id === b.sceneId)?.name ?? "?"}` : "장면 그대로"}
              {b.handoutIds.length > 0 && ` · 핸드아웃 ${b.handoutIds.length}개`}
              {b.bgmTrackId && ` · 배경음 ${tracks.find((t) => t.id === b.bgmTrackId)?.label ?? "?"}`}
              {b.sanReward && ` · SAN 보상 ${b.sanReward}`}
              {branches.length > 0 && ` · 분기 ${branches.length}개`}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {!isCurrent && b.kind !== "start" && (
                <button className="btn" disabled={!enabled || !active} onClick={() => send(gotoCmd(flow, b.id))}>{b.kind === "ending" ? "엔딩 확정" : "여기로 이동"}</button>
              )}
              {b.kind !== "ending" && <button className="btn" disabled={!enabled || flow.beats.length < 2} onClick={() => setEditing({ kind: "branch", from: b.id })}>분기 추가</button>}
              <button className="btn" disabled={!enabled} onClick={() => setEditing({ kind: "beat", beat: b })}>편집</button>
              <button className="btn danger" aria-label={`${b.name} 삭제`} disabled={!enabled} onClick={() => window.confirm(`'${b.name}'과(와) 이어진 분기를 지울까요?`) && send({ type: "flow.beat.remove", data: { id: b.id } })}>삭제</button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

const gotoCmd = (flow: Flow, beatId: string): ClientCommand =>
  flow.beats.find((b) => b.id === beatId)?.kind === "ending" ? { type: "flow.ending.choose", data: { beatId } } : { type: "flow.goto", data: { beatId } };
