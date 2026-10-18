import { describe, expect, it } from "vitest";
import { stripSslMode } from "./postgres";

describe("postgres 접속 문자열", () => {
  it("sslmode만 걷어내고 나머지는 그대로 둔다", () => {
    expect(stripSslMode("postgresql://u:p@db.x.supabase.co:5432/postgres?sslmode=require&application_name=vtt")).toBe(
      "postgresql://u:p@db.x.supabase.co:5432/postgres?application_name=vtt",
    );
    expect(stripSslMode("postgresql://u:p@h/db")).toBe("postgresql://u:p@h/db");
    expect(stripSslMode("not a url")).toBe("not a url");
  });
});
