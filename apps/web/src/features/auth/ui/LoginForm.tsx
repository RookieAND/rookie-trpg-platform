"use client";
import { useState, type ReactNode } from "react";
import { beginDiscordLogin } from "@/entities/user";
import { SUPABASE_URL } from "@/shared/config";

/** 개발용 이름 로그인. Discord 로그인으로 바뀌어도 이 자리에서 바뀐다. */
export function LoginForm({ title, description, submitLabel, onLogin }: { title: string; description?: ReactNode; submitLabel: string; onLogin: (name: string) => void }) {
  const [name, setName] = useState("");
  if (SUPABASE_URL) {
    return (
      <main className="login">
        <h1 className="brand" style={{ margin: 0, fontSize: 18 }}>{title}</h1>
        {description && <p style={{ margin: 0, color: "var(--muted)" }}>{description}</p>}
        <button className="btn primary lg" onClick={beginDiscordLogin}>디스코드로 로그인</button>
      </main>
    );
  }
  return (
    <main className="login">
      <h1 className="brand" style={{ margin: 0, fontSize: 18 }}>{title}</h1>
      {description && <p style={{ margin: 0, color: "var(--muted)" }}>{description}</p>}
      <label className="field">
        이름
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && onLogin(name)} />
      </label>
      <button className="btn primary lg" disabled={!name.trim()} aria-describedby={name.trim() ? undefined : "login-why"} onClick={() => onLogin(name)}>
        {submitLabel}
      </button>
      {!name.trim() && <div className="why" id="login-why" data-testid="login-why">이름을 적으면 시작할 수 있어요.</div>}
    </main>
  );
}
