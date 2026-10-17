import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { WsAdapter } from "@nestjs/platform-ws";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppModule } from "../app.module";
import { FileVaultRepository } from "./infrastructure/file-vault.repository";

let app: INestApplication;
let base: string;
let dir: string;

const boot = async () => {
  const ref = await Test.createTestingModule({ imports: [AppModule.register({ vault: new FileVaultRepository(dir) })] }).compile();
  const a = ref.createNestApplication();
  a.useWebSocketAdapter(new WsAdapter(a));
  await a.listen(0);
  return { a, base: `http://127.0.0.1:${(a.getHttpServer().address() as { port: number }).port}` };
};

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "vault-"));
  ({ a: app, base } = await boot());
});
afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const call = async (method: string, path: string, user: string | null, body?: unknown) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(user ? { "x-dev-user": encodeURIComponent(user) } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};

const input = (over: Record<string, unknown> = {}) => ({
  name: "윤서하",
  age: 27,
  characteristics: { STR: 50, CON: 60, SIZ: 60, DEX: 60, APP: 50, INT: 70, POW: 60, EDU: 70 },
  luck: 55,
  skills: [{ name: "도서관 이용", value: 60 }],
  ...over,
});

describe("캐릭터 보관함 REST", () => {
  it("로그인 없이는 쓸 수 없다", async () => {
    expect((await call("GET", "/characters", null)).status).toBe(401);
  });

  it("만들고, 목록에 보이고, 고치고, 지울 수 있다", async () => {
    const created = await call("POST", "/characters", "하늘", input());
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ name: "윤서하", occupation: "", notes: "" });
    const id = created.json.id as string;

    expect((await call("GET", "/characters", "하늘")).json).toHaveLength(1);

    const updated = await call("PUT", `/characters/${id}`, "하늘", input({ name: "서하", luck: 40 }));
    expect(updated.json).toMatchObject({ id, name: "서하", luck: 40 });

    expect((await call("DELETE", `/characters/${id}`, "하늘")).status).toBe(204);
    expect((await call("GET", "/characters", "하늘")).json).toEqual([]);
  });

  it("남의 보관함은 보이지도 건드릴 수도 없다", async () => {
    const id = (await call("POST", "/characters", "하늘", input())).json.id as string;
    expect((await call("GET", "/characters", "서하")).json).toEqual([]);
    expect((await call("PUT", `/characters/${id}`, "서하", input())).status).toBe(404);
    expect((await call("DELETE", `/characters/${id}`, "서하")).status).toBe(404);
  });

  it("잘못된 값은 거절한다", async () => {
    expect((await call("POST", "/characters", "하늘", input({ age: 5 }))).status).toBe(400);
    expect((await call("POST", "/characters", "하늘", { name: "x" })).status).toBe(400);
  });

  it("서버를 다시 켜도 남아 있다(파일 저장)", async () => {
    await call("POST", "/characters", "하늘", input());
    await app.close();
    ({ a: app, base } = await boot());
    expect((await call("GET", "/characters", "하늘")).json).toHaveLength(1);
  });

  it("동시에 여러 개를 만들어도 하나도 잃지 않는다", async () => {
    await Promise.all(Array.from({ length: 8 }, (_, i) => call("POST", "/characters", "하늘", input({ name: `c${i}` }))));
    expect((await call("GET", "/characters", "하늘")).json).toHaveLength(8);
  });
});
