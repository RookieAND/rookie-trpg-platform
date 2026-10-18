import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SCHEMA, stripSslMode } from "./postgres";

describe("postgres 접속 문자열", () => {
  it("sslmode만 걷어내고 나머지는 그대로 둔다", () => {
    expect(stripSslMode("postgresql://u:p@db.x.supabase.co:5432/postgres?sslmode=require&application_name=vtt")).toBe(
      "postgresql://u:p@db.x.supabase.co:5432/postgres?application_name=vtt",
    );
    expect(stripSslMode("postgresql://u:p@h/db")).toBe("postgresql://u:p@h/db");
    expect(stripSslMode("not a url")).toBe("not a url");
  });
});

describe("deploy/schema.sql", () => {
  const strip = (sql: string) =>
    sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .replace(/\s+/g, " ")
      .trim();
  it("서버가 자동으로 만드는 SCHEMA와 같은 내용이다(주석 제외)", () => {
    const file = readFileSync(resolve(import.meta.dirname, "../../../../deploy/schema.sql"), "utf8");
    expect(strip(file)).toBe(strip(SCHEMA));
  });
  it("모든 문장이 여러 번 실행해도 안전한 형태다", () => {
    for (const stmt of strip(SCHEMA).split(";").map((s) => s.trim()).filter(Boolean)) {
      expect(stmt).toMatch(/^(create table if not exists|create index if not exists|alter table \w+ add column if not exists|alter table \w+ enable row level security)/);
    }
  });
  it("공개 테이블마다 RLS를 켠다", () => {
    for (const t of ["rooms", "vaults", "libraries", "images"]) expect(SCHEMA).toContain(`alter table ${t} enable row level security`);
  });
});
