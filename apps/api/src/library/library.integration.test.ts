import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { WsAdapter } from "@nestjs/platform-ws";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppModule } from "../app.module";
import { FileLibraryRepository } from "./infrastructure/file-library.repository";

let app: INestApplication;
let base: string;
let dir: string;

const boot = async () => {
  const ref = await Test.createTestingModule({ imports: [AppModule.register({ library: new FileLibraryRepository(dir) })] }).compile();
  const a = ref.createNestApplication();
  a.useWebSocketAdapter(new WsAdapter(a));
  await a.listen(0);
  return { a, base: `http://127.0.0.1:${(a.getHttpServer().address() as { port: number }).port}` };
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "library-"));
  ({ a: app, base } = await boot());
});
afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const call = async (method: string, user: string | null, body?: unknown) => {
  const res = await fetch(`${base}/library`, {
    method,
    headers: { "content-type": "application/json", ...(user ? { "x-dev-user": encodeURIComponent(user) } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};

const lib = () => ({
  macros: [{ id: "m1", name: "한 방", expr: "1d6+2", secret: false }],
  occupations: [{ id: "o1", name: "기자", formula: "edu4", creditMin: 9, creditMax: 30, skills: ["관찰력"] }],
});

describe("개인 서재 REST", () => {
  it("로그인 없이는 쓸 수 없다", async () => {
    expect((await call("GET", null)).status).toBe(401);
    expect((await call("PUT", null, lib())).status).toBe(401);
  });

  it("처음엔 비어 있고, 저장하면 다시 불러올 수 있다", async () => {
    expect((await call("GET", "하늘")).json).toEqual({ macros: [], occupations: [] });
    expect((await call("PUT", "하늘", lib())).status).toBe(200);
    expect((await call("GET", "하늘")).json).toEqual(lib());
  });

  it("서버를 다시 켜도 남고, 다른 사람 서재는 보이지 않는다", async () => {
    await call("PUT", "하늘", lib());
    await app.close();
    ({ a: app, base } = await boot());
    expect((await call("GET", "하늘")).json).toEqual(lib());
    expect((await call("GET", "서하")).json).toEqual({ macros: [], occupations: [] });
  });

  it("규칙에 맞지 않는 서재는 거절하고 기존 값을 지키며, 내용은 서버가 다시 다듬는다", async () => {
    await call("PUT", "하늘", lib());
    const bad = await call("PUT", "하늘", { ...lib(), macros: [{ id: "m1", name: "x", expr: "ㅁㅁ", secret: false }] });
    expect(bad.status).toBe(400);
    expect((await call("PUT", "하늘", { macros: [] })).status).toBe(400);
    expect((await call("GET", "하늘")).json).toEqual(lib());
    const trimmed = await call("PUT", "하늘", { macros: [{ id: "m9", name: " 공백 ", expr: " 1d4 ", secret: true }], occupations: [] });
    expect(trimmed.json.macros[0]).toMatchObject({ name: "공백", expr: "1d4", secret: true });
  });
});
