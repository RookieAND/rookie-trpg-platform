"use client";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { resolveOnBlur } from "../model/text-sync";

/**
 * 서버 값(value)을 보여 주되, 칸에 초점이 있는 동안에는 받은 값을 미뤄 두어 입력 중인 글을 지키는 글칸.
 * 칸을 벗어나면 고친 글만 onCommit으로 저장하고, 안 고쳤으면 그 사이 받은 값을 보여 준다.
 */
export function SyncedTextarea({ value, onCommit, ...rest }: { value: string; onCommit: (text: string) => void } & Omit<ComponentProps<"textarea">, "value" | "defaultValue" | "onChange" | "onBlur" | "onFocus">) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  const base = useRef(value); // 입력을 시작할 때의 서버 글
  const remote = useRef(value); // 가장 최근에 받은 서버 글

  useEffect(() => {
    remote.current = value;
    if (!focused.current) {
      base.current = value;
      setText(value);
    }
  }, [value]);

  return (
    <textarea
      {...rest}
      value={text}
      onFocus={() => {
        focused.current = true;
        base.current = remote.current;
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => {
        focused.current = false;
        const r = resolveOnBlur({ base: base.current, local: e.currentTarget.value, remote: remote.current });
        base.current = r.next;
        setText(r.next);
        if (r.commit !== null) onCommit(r.commit);
      }}
    />
  );
}
