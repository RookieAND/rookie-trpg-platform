"use client";
import { useState } from "react";
import { parseStatInput, type StatEdit } from "../model/stat-input";

/** HP·MP·SAN·행운을 직접 적어 바꾸는 칸. `12`는 그 값으로, `+3`·`-7`은 더하고 빼며, Enter로 적용한다. */
export function StatInput({ label, current, max, disabled, onApply }: { label: string; current: number; max: number; disabled: boolean; onApply: (edit: StatEdit) => void }) {
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);
  const apply = () => {
    if (!text.trim()) return;
    const edit = parseStatInput(text, current, max);
    if (edit) {
      onApply(edit);
      setText("");
      setBad(false);
    } else {
      // 숫자가 아니면 알려 주고, 바뀌는 게 없으면 조용히 비운다.
      setBad(!/^[+\-−]?\d{1,4}$/.test(text.trim()));
      if (/^[+\-−]?\d{1,4}$/.test(text.trim())) setText("");
    }
  };
  return (
    <input
      className="input mono bar-input"
      inputMode="text"
      autoComplete="off"
      aria-label={`${label} 직접 입력`}
      aria-invalid={bad || undefined}
      placeholder={`값 · +3 · -7 (0~${max})`}
      title="숫자를 적으면 그 값으로, +3이나 -7처럼 적으면 더하고 빼요. Enter로 적용해요."
      value={text}
      disabled={disabled}
      onChange={(e) => (setText(e.target.value), setBad(false))}
      onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), apply())}
    />
  );
}
