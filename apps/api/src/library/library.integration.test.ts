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

const put = (user: string | null, library: unknown, baseRevision: number) => call("PUT", user, { ...(library as object), baseRevision });
const empty = { macros: [], occupations: [] };

describe("개인 서재 REST", () => {
  it("로그인 없이는 쓸 수 없다", async () => {
    expect((await call("GET", null)).status).toBe(401);
    expect((await put(null, lib(), 0)).status).toBe(401);
  });

  it("처음엔 비어 있고, 저장하면 번호가 오르며 다시 불러올 수 있다", async () => {
    expect((await call("GET", "하늘")).json).toEqual({ ...empty, revision: 0 });
    const saved = await put("하늘", lib(), 0);
    expect(saved.status).toBe(200);
    expect(saved.json.revision).toBe(1);
    expect((await call("GET", "하늘")).json).toEqual({ ...lib(), revision: 1 });
  });

  it("서버를 다시 켜도 남고, 다른 사람 서재는 보이지 않는다", async () => {
    await put("하늘", lib(), 0);
    await app.close();
    ({ a: app, base } = await boot());
    expect((await call("GET", "하늘")).json).toEqual({ ...lib(), revision: 1 });
    expect((await call("GET", "서하")).json).toEqual({ ...empty, revision: 0 });
  });

  it("규칙에 맞지 않는 서재는 거절하고 기존 값을 지키며, 내용은 서버가 다시 다듬는다", async () => {
    await put("하늘", lib(), 0);
    expect((await put("하늘", { ...lib(), macros: [{ id: "m1", name: "x", expr: "ㅁㅁ", secret: false }] }, 1)).status).toBe(400);
    expect((await put("하늘", { macros: [] }, 1)).status).toBe(400);
    expect((await call("PUT", "하늘", lib())).status).toBe(400); // 번호 없이는 저장할 수 없다
    expect((await call("GET", "하늘")).json).toEqual({ ...lib(), revision: 1 });
    const trimmed = await put("하늘", { macros: [{ id: "m9", name: " 공백 ", expr: " 1d4 ", secret: true }], occupations: [] }, 1);
    expect(trimmed.json.macros[0]).toMatchObject({ name: "공백", expr: "1d4", secret: true });
  });

  it("다른 기기가 먼저 저장했으면 덮어쓰지 않고 409와 최신 서재를 돌려준다", async () => {
    await put("하늘", lib(), 0); // 기기 A: 번호 1
    const other = { ...lib(), macros: [...lib().macros, { id: "m2", name: "둘째", expr: "1d4", secret: false }] };
    expect((await put("하늘", other, 1)).status).toBe(200); // 기기 A가 번호 2로
    const stale = await put("하늘", empty, 1); // 기기 B는 아직 번호 1을 들고 있다
    expect(stale.status).toBe(409);
    expect(stale.json.library).toEqual({ ...other, revision: 2 });
    expect((await call("GET", "하늘")).json).toEqual({ ...other, revision: 2 });
  });

  it("동시에 같은 번호로 저장하면 하나만 이긴다", async () => {
    const [x, y] = await Promise.all([put("하늘", lib(), 0), put("하늘", empty, 0)]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
  });

  it("번호가 없던 예전 파일도 읽는다", async () => {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { createHash } = await import("node:crypto");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${createHash("sha256").update("하늘").digest("hex").slice(0, 32)}.json`), JSON.stringify(lib()));
    expect((await call("GET", "하늘")).json).toEqual({ ...lib(), revision: 0 });
    expect((await put("하늘", empty, 0)).json.revision).toBe(1);
  });
});
