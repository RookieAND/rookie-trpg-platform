"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import type { ClientCommand, EffectSettings, Member, Role } from "@coc-vtt/shared";
import { ROLE_LABEL, SESSION_STATUS_LABEL, type SessionStatus } from "@/entities/room";
import type { Identity } from "@/entities/user";
import { EffectToggle } from "@/features/effect-preference";
import { DiscordButton } from "@/features/discord-notify";
import { InviteButton } from "@/features/invite-room";
import { EffectSettingsButton } from "@/features/manage-effects";
import { MadnessTableButton } from "@/features/manage-madness";
import type { Connection } from "@/features/room-realtime";
import { SessionControls, type EndingDefaults } from "@/features/session-control";
import { SERVICE_NAME } from "@/shared/config";
import { Menu, MenuLabel } from "@/shared/ui";

const CONNECTION_LABEL: Record<Connection, string> = { open: "연결됨", connecting: "연결 중", closed: "다시 연결 중" };

export function RoomHeader({
  me,
  roomId,
  role,
  status,
  sessionNumber,
  connection,
  members,
  effects,
  madnessTable,
  endingDefaults,
  effectsEnabled,
  onToggleEffects,
  soundControl,
  send,
}: {
  me: Identity;
  roomId: string;
  role: Role;
  status: SessionStatus;
  sessionNumber: number;
  connection: Connection;
  members: Member[];
  effects: EffectSettings;
  madnessTable: string[];
  /** 엔딩 비트에 있을 때 종료 창에 미리 채울 값 */
  endingDefaults?: EndingDefaults;
  effectsEnabled: boolean;
  onToggleEffects: () => void;
  /** 내 소리 설정 버튼 */
  soundControl?: ReactNode;
  send: (c: ClientCommand) => unknown;
}) {
  const isKp = role === "kp";
  return (
    <header className="topbar">
      <Link href="/" className="brand" aria-label="로비로 가기">{SERVICE_NAME}</Link>
      <span className="sep" />
      <Link href="/" className="crumb">← 로비</Link>
      <span className={`badge ${isKp ? "kp" : ""}`}>{ROLE_LABEL[role]}</span>
      <span className={`badge status ${status === "ACTIVE" ? "live" : ""} ${status === "PAUSED" ? "paused" : ""}`} data-testid="session-status">
        {sessionNumber > 0 ? `세션 ${sessionNumber} · ` : "세션 시작 전 · "}
        {SESSION_STATUS_LABEL[status]}
      </span>
      <span className="badge" data-testid="connection">{CONNECTION_LABEL[connection]}</span>
      <div style={{ flex: 1 }} />
      <span className="presence" title={members.filter((m) => m.online).map((m) => m.name).join(", ")}>접속 {members.filter((m) => m.online).map((m) => m.name).join(", ")}</span>
      <span className="sep" />
      {isKp && <InviteButton me={me} roomId={roomId} />}
      <Menu label="설정" title="효과·소리와 룸 설정" testId="settings-menu">
        <MenuLabel>내 화면</MenuLabel>
        <EffectToggle enabled={effectsEnabled} onToggle={onToggleEffects} />
        {soundControl}
        {isKp && <MenuLabel>룸 설정 (KP)</MenuLabel>}
        {isKp && <EffectSettingsButton effects={effects} send={send} />}
        {isKp && <MadnessTableButton entries={madnessTable} send={send} />}
        {isKp && <DiscordButton me={me} roomId={roomId} />}
      </Menu>
      {isKp && <SessionControls status={status} send={send} endingDefaults={endingDefaults} />}
    </header>
  );
}
