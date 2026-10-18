"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ClientCommand, GameObject } from "@coc-vtt/shared";
import { clampToViewport } from "../model/object-actions";
import { MarkerPanel } from "./MarkerPanel";

export interface ObjectMenuActions {
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onToggleHidden: () => void;
  onToggleLock: () => void;
  onChangeImage: (cx: number, cy: number) => void;
  onDelete: () => void;
}

/** 토큰·소품을 오른쪽 클릭(터치는 길게 누르기)하면 뜨는 메뉴. 방향키로 고르고 Esc로 닫는다. */
export function ObjectContextMenu({ obj, at, actions, send, onClose }: { obj: GameObject; at: { cx: number; cy: number }; actions: ObjectMenuActions; send: (c: ClientCommand) => unknown; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.cx, top: at.cy });
  const [renaming, setRenaming] = useState(false);
  const [marking, setMarking] = useState(false);
  const [name, setName] = useState(obj.name);
  const hidden = obj.layer === "gm";

  useLayoutEffect(() => {
    const r = root.current?.getBoundingClientRect();
    if (r) setPos(clampToViewport(at.cx, at.cy, r.width, r.height, window.innerWidth, window.innerHeight));
  }, [at.cx, at.cy, renaming, marking]);

  useEffect(() => {
    if (!renaming) root.current?.querySelector<HTMLElement>('[role="menuitem"],[role="menuitemcheckbox"]:not(:disabled)')?.focus();
  }, [renaming, marking]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const run = (fn: () => void) => () => {
    fn();
    onClose();
  };
  const commitRename = () => {
    const v = name.trim().slice(0, 40);
    if (v && v !== obj.name) actions.onRename(v);
    onClose();
  };
  const move = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"],[role="menuitemcheckbox"]:not(:disabled)') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return (
    <div ref={root} className="ctx-menu" role="menu" aria-label={`${obj.name} 메뉴`} data-testid="object-menu" style={{ left: pos.left, top: pos.top }} onKeyDown={move} onContextMenu={(e) => e.preventDefault()}>
      {renaming ? (
        <input
          className="input"
          aria-label="새 이름"
          value={name}
          maxLength={40}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") onClose();
          }}
        />
      ) : marking ? (
        <>
          <button type="button" role="menuitem" data-testid="marker-back" onClick={() => setMarking(false)}>← 메뉴로</button>
          <MarkerPanel obj={obj} canSecret enabled send={send} inMenu />
        </>
      ) : (
        <>
          <button type="button" role="menuitem" onClick={() => setRenaming(true)}>이름 바꾸기</button>
          {obj.kind === "token" && (
            <button type="button" role="menuitem" data-testid="menu-markers" onClick={() => setMarking(true)}>
              상태 표식{obj.markers?.length ? <kbd>{obj.markers.length}</kbd> : null}
            </button>
          )}
          <button type="button" role="menuitem" onClick={run(actions.onDuplicate)}>복제 <kbd>Ctrl+D</kbd></button>
          <button type="button" role="menuitem" onClick={run(actions.onToggleHidden)}>{hidden ? "보이기" : "숨기기"}</button>
          {obj.kind === "token" && (
            <button type="button" role="menuitem" onClick={run(actions.onToggleLock)}>{obj.locked ? "잠금 해제" : "잠금"}</button>
          )}
          <button type="button" role="menuitem" onClick={() => { actions.onChangeImage(pos.left, pos.top); onClose(); }}>이미지 바꾸기</button>
          <div className="ctx-sep" role="separator" />
          <button type="button" role="menuitem" className="danger" onClick={run(actions.onDelete)}>삭제 <kbd>Del</kbd></button>
        </>
      )}
    </div>
  );
}
