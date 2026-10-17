"use client";
import { useState, type ReactNode } from "react";
import { beginDiscordLogin } from "@/entities/user";
import { SUPABASE_URL } from "@/shared/config";

/** 개발용 이름 로그인. Discord 로그인으로 바뀌어도 이 자리에서 바뀐다. */
export function LoginForm({ title, description, submitLabel, onLogin }: { title: string; description?: ReactNode; submitLabel: string; onLogin: (name: string) => void }) {
  const [name, setName] = useState("");
  if (SUPABASE_URL) {
    return (
      <main style={{ maxWidth: 360, margin: "120px auto", display: "grid", gap: 12, padding: "0 16px" }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>{title}</h1>
        {description && <p style={{ margin: 0, color: "var(--muted)" }}>{description}</p>}
        <button className="btn primary" onClick={beginDiscordLogin}>디스코드로 로그인</button>
      </main>
    );
  }
  return (
    <main style={{ maxWidth: 360, margin: "120px auto", display: "grid", gap: 12, padding: "0 16px" }}>
      <h1 style={{ margin: 0, fontSize: 22 }}>{title}</h1>
      {description && <p style={{ margin: 0, color: "var(--muted)" }}>{description}</p>}
      <label>
        이름
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && onLogin(name)} />
      </label>
      <button className="btn primary" disabled={!name.trim()} onClick={() => onLogin(name)}>
        {submitLabel}
      </button>
    </main>
  );
}
