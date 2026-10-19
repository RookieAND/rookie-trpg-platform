"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import type { BannedUser, ChatSettings, ClientCommand, EffectSettings, Member, Role } from "@coc-vtt/shared";
import { ROLE_LABEL, SESSION_STATUS_LABEL, type SessionStatus } from "@/entities/room";
import type { Identity } from "@/entities/user";
import { EffectToggle } from "@/features/effect-preference";
import { DiscordButton } from "@/features/discord-notify";
import { InviteButton } from "@/features/invite-room";
import { EffectSettingsButton } from "@/features/manage-effects";
import { MadnessTableButton } from "@/features/manage-madness";
import { RoomSafetyButton } from "@/features/room-safety";
import type { Connection } from "@/features/room-realtime";
import { useScenarioPrep } from "@/features/scenario-prep";
import { SessionControls, type EndingDefaults } from "@/features/session-control";
import type { ScenarioImportResult } from "@/entities/room";
import { SERVICE_NAME } from "@/shared/config";
import { Menu, MenuLabel } from "@/shared/ui";

const CONNECTION_LABEL: Record<Connection, string> = { open: "연결됨", connecting: "연결 중", closed: "다시 연결 중" };

export function RoomHeader({
  me,
  roomId,
  role,
  status,
  kpAway = false,
  sessionNumber,
  connection,
  members,
  banned = [],
  chatSettings,
  effects,
  madnessTable,
  endingDefaults,
  effectsEnabled,
  onToggleEffects,
  soundControl,
  soundHint,
  roomName,
  onRenamed,
  notify,
  onImported,
  onShortcutHelp,
  send,
}: {
  me: Identity;
  roomId: string;
  role: Role;
  status: SessionStatus;
  /** GM 연결이 끊겨 유예 중(PL에게만 의미가 있다) */
  kpAway?: boolean;
  sessionNumber: number;
  connection: Connection;
  members: Member[];
  /** 차단한 사람(GM만 받는다) */
  banned?: BannedUser[];
  /** 룸 설정(PL 수치 직접 수정 허용 여부를 보여 준다) */
  chatSettings?: ChatSettings;
  effects: EffectSettings;
  madnessTable: string[];
  /** 엔딩 비트에 있을 때 종료 창에 미리 채울 값 */
  endingDefaults?: EndingDefaults;
  effectsEnabled: boolean;
  onToggleEffects: () => void;
  /** 내 소리 설정 버튼 */
  soundControl?: ReactNode;
  /** 소리가 막혔을 때만 보이는 작은 안내 */
  soundHint?: ReactNode;
  /** 룸 이름과, 주인이 이름을 바꾸거나 시나리오를 가져왔을 때 알려 줄 곳 */
  roomName: string;
  onRenamed: (name: string) => void;
  notify: (text: string) => void;
  onImported: (r: ScenarioImportResult) => void;
  /** 설정 메뉴의 ‘단축키’ 항목이 부른다 */
  onShortcutHelp?: () => void;
  send: (c: ClientCommand) => unknown;
}) {
  const isKp = role === "kp";
  const prep = useScenarioPrep({ me, roomId, roomName, onRenamed, notify, onImported });
  return (
    <header className="topbar">
      <Link href="/" className="brand" aria-label="로비로 가기">{SERVICE_NAME}</Link>
      <Link href="/" className="crumb">← 로비</Link>
      <span className={`badge ${isKp ? "kp" : ""}`}>{ROLE_LABEL[role]}</span>
      {role === "spectator" && <span className="badge paused" data-testid="spectator-badge" title="보기만 할 수 있어요. 굴림·이동·편집은 막혀 있어요">관전 중</span>}
      {kpAway && <span className="badge paused" role="status" data-testid="kp-away-badge">GM 끊김</span>}
      <span className={`badge status ${status === "ACTIVE" ? "live" : ""} ${status === "PAUSED" ? "paused" : ""}`} data-testid="session-status">
        {sessionNumber > 0 ? `세션 ${sessionNumber} · ` : "세션 시작 전 · "}
        {SESSION_STATUS_LABEL[status]}
      </span>
      <span className="badge plain conn" data-testid="connection" data-state={connection}>{CONNECTION_LABEL[connection]}</span>
      {soundHint}
      <div className="spacer" />
      <span className="presence" title={members.filter((m) => m.online && m.role !== "spectator").map((m) => m.name).join(", ")}>접속 {members.filter((m) => m.online && m.role !== "spectator").map((m) => m.name).join(", ")}</span>
      {isKp && (
        <span className="badge plain" data-testid="spectator-count" title={members.filter((m) => m.role === "spectator" && m.online).map((m) => m.name).join(", ") || "관전자가 없어요"}>
          관전 {members.filter((m) => m.role === "spectator" && m.online).length}
        </span>
      )}
      <span className="sep" />
      {isKp && <InviteButton me={me} roomId={roomId} members={members} banned={banned} send={send} />}
      {isKp && prep.node}
      <Menu label="설정" title="효과·소리와 룸 설정" testId="settings-menu">
        {(close) => (
          <>
            <MenuLabel>내 화면</MenuLabel>
            <EffectToggle enabled={effectsEnabled} onToggle={onToggleEffects} />
            {soundControl}
            {onShortcutHelp && <button type="button" className="btn" data-testid="open-shortcuts" aria-keyshortcuts="?" onClick={() => { close(); onShortcutHelp(); }}>단축키 보기 (?)</button>}
            {isKp && <MenuLabel>룸 설정 (GM)</MenuLabel>}
            {isKp && <EffectSettingsButton effects={effects} send={send} />}
            {isKp && <MadnessTableButton entries={madnessTable} send={send} />}
            {isKp && <DiscordButton me={me} roomId={roomId} />}
            {isKp && <RoomSafetyButton me={me} roomId={roomId} settings={chatSettings} send={send} />}
            {isKp && <MenuLabel>준비 (GM)</MenuLabel>}
            {isKp && prep.items(close)}
          </>
        )}
      </Menu>
      {isKp && <SessionControls status={status} send={send} endingDefaults={endingDefaults} />}
    </header>
  );
}
