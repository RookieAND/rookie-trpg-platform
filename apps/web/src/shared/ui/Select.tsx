"use client";
import { Children, Fragment, isValidElement, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";

/** 기본 <select> 대신 쓰는 드롭다운. <option>/<optgroup>을 그대로 자식으로 받고, onChange는 e.target.value로 읽을 수 있다. */
export interface SelectChange {
  target: { value: string };
  currentTarget: { value: string };
}

export interface SelectProps {
  value: string | number | undefined;
  onChange?: (e: SelectChange) => void;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  id?: string;
  title?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "data-testid"?: string;
}

interface Opt {
  value: string;
  label: string;
  disabled: boolean;
  group?: string;
}

const textOf = (n: ReactNode): string => {
  if (n === null || n === undefined || typeof n === "boolean") return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(textOf).join("");
  if (isValidElement(n)) return textOf((n.props as { children?: ReactNode }).children);
  return "";
};

function collect(children: ReactNode, group: string | undefined, out: Opt[]): void {
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return;
    const el = c as ReactElement<{ value?: string | number; disabled?: boolean; label?: string; children?: ReactNode }>;
    if (el.type === "option") {
      const label = textOf(el.props.children);
      out.push({ value: el.props.value !== undefined ? String(el.props.value) : label, label, disabled: Boolean(el.props.disabled), ...(group ? { group } : {}) });
    } else if (el.type === "optgroup") {
      collect(el.props.children, el.props.label, out);
    } else if (el.type === Fragment) {
      collect(el.props.children, group, out);
    }
  });
}

export function Select(p: SelectProps) {
  const opts = useMemo(() => {
    const out: Opt[] = [];
    collect(p.children, undefined, out);
    return out;
  }, [p.children]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [box, setBox] = useState<{ left: number; top?: number; bottom?: number; width: number; maxH: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typed = useRef({ s: "", t: 0 });
  const uid = useId();

  const cur = p.value === undefined ? "" : String(p.value);
  const selectedIndex = opts.findIndex((o) => o.value === cur);
  const selected = selectedIndex >= 0 ? opts[selectedIndex] : undefined;

  const close = () => setOpen(false);
  const pick = (i: number) => {
    const o = opts[i];
    if (!o || o.disabled) return;
    setOpen(false);
    trigger.current?.focus();
    if (o.value !== cur) p.onChange?.({ target: { value: o.value }, currentTarget: { value: o.value } });
  };
  const firstEnabled = (from: number, step: 1 | -1) => {
    for (let i = from; i >= 0 && i < opts.length; i += step) if (!opts[i]!.disabled) return i;
    return -1;
  };

  const show = () => {
    if (p.disabled) return;
    setActive(selectedIndex >= 0 ? selectedIndex : firstEnabled(0, 1));
    setOpen(true);
  };

  // 열릴 때 자리를 잡는다: 아래 공간이 모자라면 위로 연다.
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const want = Math.min(300, opts.length * 34 + 12);
    const up = below < want && above > below;
    const maxH = Math.max(120, Math.min(300, up ? above : below));
    const width = Math.max(r.width, 140);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setBox(up ? { left, bottom: window.innerHeight - r.top + 4, width, maxH } : { left, top: r.bottom + 4, width, maxH });
  }, [open, opts.length]);

  useEffect(() => {
    if (!open) {
      setBox(null);
      return;
    }
    const away = (e: Event) => {
      const t = e.target as Node;
      if (trigger.current?.contains(t) || list.current?.contains(t)) return;
      setOpen(false);
    };
    // 열린 채로 트리거가 움직였을 때만 닫는다(관계없는 곳의 스크롤에는 그대로 둔다).
    const r0 = trigger.current?.getBoundingClientRect();
    const scroll = (e: Event) => {
      if (list.current?.contains(e.target as Node)) return;
      const r = trigger.current?.getBoundingClientRect();
      if (!r0 || !r || Math.abs(r.top - r0.top) > 1 || Math.abs(r.left - r0.left) > 1) setOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [open]);

  useEffect(() => {
    // 목록 안에서만 스크롤한다(scrollIntoView는 바깥 화면까지 밀어 목록이 닫힐 수 있다).
    const l = list.current;
    const el = open && active >= 0 ? l?.querySelector<HTMLElement>(`[data-i="${active}"]`) : null;
    if (l && el) {
      if (el.offsetTop < l.scrollTop) l.scrollTop = el.offsetTop - 4;
      else if (el.offsetTop + el.offsetHeight > l.scrollTop + l.clientHeight) l.scrollTop = el.offsetTop + el.offsetHeight - l.clientHeight + 4;
    }
  }, [open, active, box]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (p.disabled) return;
    const k = e.key;
    if (!open) {
      if (k === "ArrowDown" || k === "ArrowUp" || k === "Enter" || k === " ") {
        e.preventDefault();
        show();
      }
      return;
    }
    if (k === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (k === "Tab") {
      close();
    } else if (k === "ArrowDown") {
      e.preventDefault();
      const n = firstEnabled(active + 1, 1);
      if (n >= 0) setActive(n);
    } else if (k === "ArrowUp") {
      e.preventDefault();
      const n = firstEnabled(active - 1, -1);
      if (n >= 0) setActive(n);
    } else if (k === "Home") {
      e.preventDefault();
      setActive(firstEnabled(0, 1));
    } else if (k === "End") {
      e.preventDefault();
      setActive(firstEnabled(opts.length - 1, -1));
    } else if (k === "Enter" || k === " ") {
      e.preventDefault();
      pick(active);
    } else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      const ty = typed.current;
      ty.s = now - ty.t > 700 ? k : ty.s + k;
      ty.t = now;
      const q = ty.s.toLowerCase();
      const from = ty.s.length === 1 ? active + 1 : active;
      const hit = [...opts.keys()].sort((a, b) => ((a - from + opts.length) % opts.length) - ((b - from + opts.length) % opts.length)).find((i) => !opts[i]!.disabled && opts[i]!.label.toLowerCase().startsWith(q));
      if (hit !== undefined) setActive(hit);
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${uid}-list` : undefined}
        aria-activedescendant={open && active >= 0 ? `${uid}-o${active}` : undefined}
        id={p.id}
        title={p.title}
        disabled={p.disabled}
        className={`select-trigger ${p.className ?? ""}`}
        style={p.style}
        data-testid={p["data-testid"]}
        data-value={cur}
        aria-label={p["aria-label"]}
        aria-labelledby={p["aria-labelledby"]}
        aria-describedby={p["aria-describedby"]}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKeyDown}
      >
        <span className="select-label">{selected?.label || " "}</span>
        <span className="select-caret" aria-hidden>▾</span>
      </button>
      {open && (
        <div
          ref={list}
          id={`${uid}-list`}
          role="listbox"
          className="select-list"
          style={box ? { left: box.left, top: box.top, bottom: box.bottom, minWidth: box.width, maxHeight: box.maxH } : { visibility: "hidden" }}
          onMouseDown={(e) => e.preventDefault()}
          // <label> 안에 있어도 목록을 누른 것이 라벨 클릭으로 되돌아와 다시 열리지 않게 한다.
          onClick={(e) => e.preventDefault()}
        >
          {opts.map((o, i) => (
            <Fragment key={`${o.value}:${i}`}>
              {o.group && o.group !== opts[i - 1]?.group && <div className="select-group" role="presentation">{o.group}</div>}
              <div
                id={`${uid}-o${i}`}
                data-i={i}
                data-value={o.value}
                role="option"
                aria-selected={i === selectedIndex}
                aria-disabled={o.disabled || undefined}
                className={`select-opt${i === active ? " active" : ""}${i === selectedIndex ? " selected" : ""}`}
                onMouseMove={() => !o.disabled && active !== i && setActive(i)}
                onClick={() => pick(i)}
              >
                <span className="select-opt-label">{o.label || " "}</span>
                {i === selectedIndex && <span aria-hidden className="select-check">✓</span>}
              </div>
            </Fragment>
          ))}
        </div>
      )}
    </>
  );
}
