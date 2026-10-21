"use client";
import { useState } from "react";
import { Pause, Play, Square } from "lucide-react";
import type { ClientCommand } from "@coc-vtt/shared";
import type { SessionStatus } from "@/entities/room";
import { Dialog } from "@/shared/ui";

/** GM의 세션 버튼. 상태에 따라 시작/일시정지/이어하기/종료가 바뀐다. 종료는 정산 창을 거친다. */
export interface EndingDefaults {
  name?: string;
  sanReward?: string;
}

export function SessionControls({ status, send, endingDefaults }: { status: SessionStatus; send: (c: ClientCommand) => unknown; endingDefaults?: EndingDefaults }) {
  const [ending, setEnding] = useState(false);
  const cmd = (type: "session.start" | "session.pause" | "session.resume") => () => send({ type, data: {} });
  return (
    <>
      {status === "IDLE" && <button className="btn primary" title="세션 시작" onClick={cmd("session.start")}><Play aria-hidden /><span className="lbl">세션 시작</span></button>}
      {status === "ACTIVE" && <button className="btn" title="일시정지" onClick={cmd("session.pause")}><Pause aria-hidden /><span className="lbl">일시정지</span></button>}
      {status === "PAUSED" && <button className="btn primary" title="이어하기" onClick={cmd("session.resume")}><Play aria-hidden /><span className="lbl">이어하기</span></button>}
      {status !== "IDLE" && <button className="btn danger quiet" title="세션 종료" onClick={() => setEnding(true)}><Square aria-hidden /><span className="lbl">세션 종료</span></button>}
      {ending && status !== "IDLE" && <EndDialog onClose={() => setEnding(false)} send={send} defaults={endingDefaults} />}
    </>
  );
}

function EndDialog({ onClose, send, defaults }: { onClose: () => void; send: (c: ClientCommand) => unknown; defaults?: EndingDefaults }) {
  const [ending, setEnding] = useState(defaults?.name ?? "");
  const [san, setSan] = useState(defaults?.sanReward ?? "");
  const [growth, setGrowth] = useState(true);

  const submit = () => {
    const ok = send({
      type: "session.end",
      data: { growth, ...(ending.trim() ? { ending: ending.trim() } : {}), ...(san.trim() ? { sanReward: san.trim() } : {}) },
    });
    if (ok !== false) onClose();
  };

  return (
    <Dialog label="세션 종료" onClose={onClose} className="dialog">
      <strong>세션을 끝낼까요?</strong>
      <label style={{ display: "grid", gap: 4 }}>
        엔딩 이름 (선택)
        <input className="input" value={ending} maxLength={40} onChange={(e) => setEnding(e.target.value)} placeholder="예: 새벽의 생존자" />
      </label>
      <label style={{ display: "grid", gap: 4 }}>
        SAN 보상 (선택)
        <input className="input" value={san} maxLength={64} onChange={(e) => setSan(e.target.value)} placeholder="예: 1d6+1d4 (참가자마다 한 번씩 굴려요)" />
      </label>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="checkbox" checked={growth} onChange={() => setGrowth(!growth)} style={{ accentColor: "#7c86f7" }} />
        성장 표시를 한 기능은 성장 굴림을 해요
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn danger" onClick={submit}>정산하고 종료</button>
        <button className="btn" onClick={onClose}>취소</button>
      </div>
    </Dialog>
  );
}
