"use client";
import "./hint.css";
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { GLOSSARY, type GlossaryKey } from "./glossary";

interface Props {
  /** 용어집에서 가져온 설명 */
  term?: GlossaryKey;
  /** 직접 쓴 설명(term이 없을 때) */
  text?: ReactNode;
  title?: string;
  /** 있으면 ? 대신 이 내용이 점선 밑줄 버튼이 된다 */
  children?: ReactNode;
  /** 스크린리더가 읽을 버튼 이름 */
  label?: string;
}

const WIDTH = 260;

/**
 * 용어 옆의 도움말. 눌러서(Enter·Space) 열고 닫고, Esc로 닫고, 바깥을 눌러도 닫는다.
 * 마우스를 올리면 잠깐 보인다. 패널의 overflow에 잘리지 않도록 화면 기준(fixed)으로 띄운다.
 */
export function Hint({ term, text, title, children, label }: Props) {
  const entry = term ? GLOSSARY[term] : null;
  const heading = title ?? entry?.title;
  const body = text ?? entry?.body;
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const [pinned, setPinned] = useState(false);
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const open = pinned || hover;

  useEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left + r.width / 2 - WIDTH / 2, window.innerWidth - WIDTH - 8));
    const below = r.bottom + 8 + 140 < window.innerHeight;
    setPos(below ? { left, top: r.bottom + 6 } : { left, bottom: window.innerHeight - r.top + 6 });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setPinned(false);
      setHover(false);
      btn.current?.focus();
    };
    const onDown = (e: MouseEvent) => {
      if (btn.current && !btn.current.contains(e.target as Node) && !(e.target as Element).closest?.(".hint-pop")) setPinned(false);
    };
    const close = () => {
      setPinned(false);
      setHover(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  if (!body) return null;
  const name = label ?? `${heading ?? "용어"} 설명`;
  return (
    <span className="hint">
      <button
        ref={btn}
        type="button"
        className={children ? "hint-term" : "hint-btn"}
        aria-label={children ? undefined : name}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setPinned((p) => !p)}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onBlur={() => setPinned(false)}
      >
        {children ?? "?"}
      </button>
      {open && (
        <span id={id} role="tooltip" className="hint-pop" style={{ ...pos, width: WIDTH }}>
          {heading && <strong>{heading}</strong>}
          <span>{body}</span>
        </span>
      )}
    </span>
  );
}
