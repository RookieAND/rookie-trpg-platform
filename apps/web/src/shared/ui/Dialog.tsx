"use client";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { isTop, trapTarget } from "./dialog-focus";
import { focusReturnTarget } from "./focus-return";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const stack: object[] = [];

/**
 * 모달 대화상자. 열리면 안으로 초점이 들어오고, Tab은 안에서만 돌며, Esc로 닫히고,
 * 닫히면 열었던 곳으로 초점이 돌아간다. 제목은 label(aria-label)로 붙인다.
 */
export function Dialog({ label, onClose, children, ...rest }: { label: string; onClose: () => void } & Omit<ComponentProps<"div">, "role" | "aria-label" | "aria-modal">) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // 그려지기 전의 초점 자리가 곧 연 곳이다.
  const [opener] = useState<Element | null>(() => (typeof document === "undefined" ? null : focusReturnTarget(document.activeElement)));

  useEffect(() => {
    const el = ref.current;
    const token = {};
    stack.push(token);
    if (el && !el.contains(document.activeElement)) ((el.querySelector(FOCUSABLE) as HTMLElement | null) ?? el).focus();
    const onKey = (e: KeyboardEvent) => {
      if (!el || !isTop(stack, token)) return;
      if (e.key === "Escape") {
        e.stopPropagation();
        closeRef.current();
      } else if (e.key === "Tab") {
        const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
        const to = trapTarget(items.length, items.indexOf(document.activeElement as HTMLElement), e.shiftKey);
        if (to === null) return;
        e.preventDefault();
        (to < 0 ? el : items[to]!).focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      stack.splice(stack.indexOf(token), 1);
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [opener]);

  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} {...rest}>
      {children}
    </div>
  );
}
