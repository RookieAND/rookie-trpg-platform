"use client";
import { useState } from "react";
import { MARKER_DEF, MARKER_TEXT_MAX, type ClientCommand, type GameObject, type MarkerKey } from "@coc-vtt/shared";
import { markerCommand, markerRows } from "../model/markers";

const SHAPE_CHIP: Record<string, string> = { circle: "50%", square: "3px", pill: "999px" };

/** 한 줄 앞의 작은 견본(표식과 같은 색·기호). 색만 보지 않도록 기호를 함께 둔다. */
function Swatch({ k }: { k: MarkerKey }) {
  const d = MARKER_DEF[k];
  return (
    <span className="mk-swatch" aria-hidden style={{ color: d.color, borderColor: d.color, borderRadius: SHAPE_CHIP[d.shape] ?? "4px" }}>
      {d.glyph}
    </span>
  );
}

interface Props {
  obj: GameObject;
  /** 비밀(GM만 보임) 표식을 쓸 수 있는가(GM) */
  canSecret: boolean;
  /** 지금 바꿀 수 있는가(세션 중이거나 GM) */
  enabled: boolean;
  send: (c: ClientCommand) => unknown;
  /** 메뉴 안에서는 방향키 이동을 위해 menuitemcheckbox 역할을 쓴다 */
  inMenu?: boolean;
}

/**
 * 토큰의 상태 표식을 켜고 끈다(GM과 토큰 주인). 비밀(GM만 보임)을 켜 두고 누르면 그 표식은 GM에게만 보인다.
 * 표식 열 가지 중 "사용자 지정"은 8자까지의 글을 적는다.
 */
export function MarkerPanel({ obj, canSecret, enabled, send, inMenu = false }: Props) {
  const [secret, setSecret] = useState(false);
  const [text, setText] = useState("");
  const rows = markerRows(obj.markers);
  const item = inMenu ? { role: "menuitemcheckbox" as const } : {};
  const toggle = (key: MarkerKey, on: boolean, current?: { text: string; secret: boolean }) => {
    const c = markerCommand(obj, key, on, { secret: on ? (current ? current.secret : secret) : false, text: key === "custom" ? (current?.text ?? text) : undefined });
    if (c) send(c);
  };
  return (
    <div className="mk-panel" data-testid="marker-panel" role="group" aria-label={`${obj.name} 상태 표식`}>
      <div className="mk-head">상태 표식</div>
      {canSecret && (
        <label className="mk-secret">
          <input type="checkbox" data-testid="marker-secret-switch" checked={secret} onChange={(e) => setSecret(e.target.checked)} disabled={!enabled} />
          <span>GM만 보이게 켜기<span className="mk-secret-sub">새로 켜는 표식이 PL에게 안 보여요</span></span>
        </label>
      )}
      <div className="mk-list">
        {rows.map((r) => (
          <div key={r.key} className="mk-row">
            <button
              type="button"
              {...item}
              {...(inMenu ? { "aria-checked": r.on } : { "aria-pressed": r.on })}
              className={`mk-btn${r.on ? " on" : ""}`}
              data-testid={`marker-toggle-${r.key}`}
              disabled={!enabled || (r.key === "custom" && !r.on && !text.trim())}
              title={r.key === "custom" && !r.on && !text.trim() ? "아래 칸에 글을 먼저 적어요" : undefined}
              onClick={() => toggle(r.key, !r.on, r.on ? { text: r.text, secret: r.secret } : undefined)}
            >
              <Swatch k={r.key} />
              <span className="mk-label">{r.key === "custom" && r.on ? r.text : r.label}</span>
            </button>
            {canSecret && r.on && (
              <button
                type="button"
                role="switch"
                className="mk-switch"
                data-testid={`marker-secret-${r.key}`}
                aria-checked={r.secret}
                aria-label={`${r.key === "custom" ? r.text : r.label} 표식을 GM만 보기`}
                title={r.secret ? "지금 GM에게만 보여요. 누르면 모두에게 보여요" : "지금 모두에게 보여요. 누르면 GM에게만 보여요"}
                disabled={!enabled}
                onClick={() => {
                  const c = markerCommand(obj, r.key, true, { secret: !r.secret, text: r.text });
                  if (c) send(c);
                }}
              >
                <span className="mk-switch-track" aria-hidden><span className="mk-switch-knob" /></span>
                <span className="mk-switch-text">GM만</span>
              </button>
            )}
          </div>
        ))}
      </div>
      <input
        className="input mk-text"
        data-testid="marker-custom-text"
        aria-label="사용자 지정 표식 글"
        placeholder={`사용자 지정 글 (${MARKER_TEXT_MAX}자까지)`}
        maxLength={MARKER_TEXT_MAX}
        value={text}
        disabled={!enabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && text.trim()) toggle("custom", true, { text, secret });
        }}
      />
    </div>
  );
}
