"use client";
import { useEffect, useState } from "react";
import { Dialog } from "@/shared/ui";
import { modKey } from "@/shared/lib";
import { isHelpKey, shortcutGroups } from "../model/shortcuts";

/** 단축키 도움말 창을 여닫는 상태. ?(Shift+/)를 누르면 열린다. 대화상자나 메뉴가 열려 있으면 건드리지 않는다. */
export function useShortcutHelp() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !isHelpKey(e)) return;
      if (!open && document.querySelector('[role="dialog"],[aria-modal="true"]')) return;
      e.preventDefault();
      setOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return { open, show: () => setOpen(true), close: () => setOpen(false) };
}

export function ShortcutHelp({ isKp, onClose }: { isKp: boolean; onClose: () => void }) {
  const groups = shortcutGroups({ isKp, mod: modKey() });
  return (
    <Dialog label="단축키" onClose={onClose} onClick={onClose} className="help-veil" data-testid="shortcut-help">
      <div className="help-card" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
          <h2 style={{ margin: 0, fontSize: 15 }}>단축키</h2>
          <button type="button" className="btn" onClick={onClose}>닫기</button>
        </div>
        <p className="why" style={{ margin: 0 }}>보드를 고른 상태에서 눌러요. 글을 쓰는 중에는 동작하지 않아요.</p>
        {groups.map((g) => (
          <section key={g.title} aria-label={g.title} className="help-group">
            <h3 className="section-title">{g.title}</h3>
            <dl className="help-list">
              {g.items.map((it) => (
                <div key={it.keys.join("|")} className="help-row">
                  <dt>
                    {it.keys.map((k, i) => (
                      <span key={k}>
                        {i > 0 && <span className="help-or"> 또는 </span>}
                        <kbd className="kbd">{k}</kbd>
                      </span>
                    ))}
                  </dt>
                  <dd>{it.text}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
