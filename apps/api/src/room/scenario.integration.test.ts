import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Test } from "@nestjs/testing";
import { WsAdapter } from "@nestjs/platform-ws";
import type { INestApplication } from "@nestjs/common";
import WebSocket from "ws";
import { SAMPLE_SCENARIO } from "@coc-vtt/shared";
import type { Authenticate } from "../identity/domain/identity";
import { AppModule } from "../app.module";
import { MemoryImageStorage } from "../image/infrastructure/memory-image.storage";

let app: INestApplication;
let base: string;
let port: number;
let images: MemoryImageStorage;

/** 운영처럼 Bearer 토큰만 받는 인증(개발용 헤더·쿼리는 통하지 않는다). 토큰 "t-이름" → 이름. */
const bearerOnly: Authenticate = (req, url) => {
  const h = req.headers.authorization;
  const m = /^Bearer t-(\w+)$/.exec(Array.isArray(h) ? (h[0] ?? "") : (h ?? ""));
  const token = m?.[1] ?? url.searchParams.get("token")?.replace(/^t-/, "");
  return token ? { userId: token, name: token, requestedRole: "pl" } : null;
};

async function boot(opts: { prod?: boolean } = {}) {
  images = new MemoryImageStorage();
  const ref = await Test.createTestingModule({
    imports: [AppModule.register({ registry: { saveDebounceMs: 20 }, images, ...(opts.prod ? { authenticate: bearerOnly } : {}) })],
  }).compile();
  app = ref.createNestApplication();
  app.useWebSocketAdapter(new WsAdapter(app));
  await app.listen(0);
  port = (app.getHttpServer().address() as { port: number }).port;
  base = `http://127.0.0.1:${port}`;
}
beforeEach(() => boot());
afterEach(() => app.close());

const auth = (user: string, prod: boolean): Record<string, string> => (prod ? { authorization: `Bearer t-${user}` } : { "x-dev-user": user, "x-dev-name": user });
const call = async (method: string, path: string, user: string, body?: string, prod = false) => {
  const res = await fetch(`${base}${path}`, { method, headers: { "content-type": /import|\/scenario/.test(path) ? "text/plain" : "application/json", ...auth(user, prod) }, body });
  const t = await res.text();
  return { status: res.status, text: t, json: t ? JSON.parse(t) : null, headers: res.headers };
};
const json = (o: unknown) => JSON.stringify(o);
const sample = (over: Record<string, unknown> = {}) => json({ ...SAMPLE_SCENARIO, ...over });

async function join(roomId: string, user: string, prod = false) {
  const q = prod ? `token=t-${user}` : `user=${user}&name=${user}`;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${roomId}&${q}`);
  const received: Array<{ seq: number; event: { type: string; data: any } }> = [];
  ws.on("message", (raw) => received.push(JSON.parse(raw.toString())));
  await new Promise<void>((resolve, reject) => (ws.once("open", () => resolve()), ws.once("error", reject)));
  ws.send(json({ type: "join", data: {} }));
  for (let i = 0; i < 100 && !received.some((m) => m.event.type === "snapshot"); i++) await new Promise((r) => setTimeout(r, 10));
  return { ws, received, snap: () => received.find((m) => m.event.type === "snapshot")!.event.data };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("룸에 시나리오 가져오기", () => {
  for (const prod of [false, true]) {
    it(`${prod ? "운영 인증(Bearer)" : "개발 인증"}에서 미리보기 → 적용 → 되돌리기`, async () => {
      if (prod) {
        await app.close();
        await boot({ prod: true });
      }
      const room = (await call("POST", "/rooms", "kp1", json({ name: "저택" }), prod)).json;
      const kp = await join(room.id, "kp1", prod);
      const dry = await call("POST", `/rooms/${room.id}/scenario?dryRun=1`, "kp1", sample(), prod);
      expect(dry.status).toBe(200);
      expect(dry.json.dryRun).toBe(true);
      expect(dry.json.counts.scenes).toBe(2);
      expect(dry.json.warnings.join()).toContain("첫 번째 PL");
      await sleep(50);
      expect(kp.received.some((m) => m.event.type === "scene.added")).toBe(false);
      expect(images.size).toBe(0);

      const ok = await call("POST", `/rooms/${room.id}/scenario`, "kp1", sample(), prod);
      expect(ok.status).toBe(200);
      expect(ok.json.importId).toBeTruthy();
      await sleep(80);
      expect(kp.received.some((m) => m.event.type === "scene.added" || m.event.type === "scenario.imported" || m.event.type === "snapshot")).toBe(true);
      const state = await call("GET", `/rooms/${room.id}/export?format=scenario`, "kp1", undefined, prod);
      expect(state.json.scenes.map((s: { name: string }) => s.name)).toEqual(["현관", "지하실"]);
      expect(state.json.media).toBeTruthy();

      kp.ws.send(json({ id: "r1", command: { type: "scenario.revert", data: { importId: ok.json.importId } } }));
      await sleep(100);
      const after = await call("GET", `/rooms/${room.id}/export?format=scenario`, "kp1", undefined, prod);
      expect(after.json.tokens).toHaveLength(0);
      kp.ws.close();
    });
  }

  it("주인만 가져오고 내보낼 수 있어요", async () => {
    const room = (await call("POST", "/rooms", "kp1", json({ name: "저택" }))).json;
    await join(room.id, "kp1");
    expect((await call("POST", `/rooms/${room.id}/scenario`, "pl1", sample())).status).toBe(403);
    expect((await call("GET", `/rooms/${room.id}/export`, "pl1")).status).toBe(403);
    expect((await call("PATCH", `/rooms/${room.id}`, "pl1", json({ name: "남의 룸" }))).status).toBe(403);
  });

  it("문제가 있으면 위치와 이유를 알려 주고 룸은 그대로예요", async () => {
    const room = (await call("POST", "/rooms", "kp1", json({ name: "저택" }))).json;
    const kp = await join(room.id, "kp1");
    const bad = await call("POST", `/rooms/${room.id}/scenario`, "kp1", sample({ tokens: [{ scene: "없는장면", kind: "prop", name: "상자", x: 1, y: 1 }] }));
    expect(bad.status).toBe(422);
    expect(bad.json.errors.join("\n")).toContain("없는장면");
    expect((await call("POST", `/rooms/${room.id}/scenario`, "kp1", "{ 깨진 json")).status).toBe(422);
    const state = await call("GET", `/rooms/${room.id}/export?format=scenario`, "kp1");
    expect(state.json.tokens).toHaveLength(0);
    expect(images.size).toBe(0);
    kp.ws.close();
  });

  it("너무 자주 가져오면 막아요", async () => {
    const room = (await call("POST", "/rooms", "kp1", json({ name: "저택" }))).json;
    const kp = await join(room.id, "kp1");
    let last = 0;
    for (let i = 0; i < 41; i++) last = (await call("POST", `/rooms/${room.id}/scenario`, "kp1", sample({ scenes: [{ key: "s", name: "방" }], tokens: [], characters: [], handouts: [], beats: [], branches: [] }))).status;
    expect(last).toBe(429);
    kp.ws.close();
  });
});

describe("새 룸으로 가져오기와 백업", () => {
  it("파일로 새 룸을 만들면 내가 GM이고, 이름을 바꿔 쓸 수 있어요", async () => {
    const r = await call("POST", "/rooms/import?name=" + encodeURIComponent("새 저택"), "kp1", sample());
    expect(r.status).toBe(201);
    expect(r.json.name).toBe("새 저택");
    expect(r.json.counts.tokens).toBe(4);
    const mine = await call("GET", `/rooms/${r.json.id}`, "kp1");
    expect(mine.status).toBe(200);
  });

  it("백업 → 새 룸 왕복: 이미지는 복사되어 한 룸을 지워도 다른 룸이 멀쩡하고, 비밀은 담기지 않아요", async () => {
    const a = (await call("POST", "/rooms/import", "kp1", sample())).json;
    await call("PUT", `/rooms/${a.id}/discord`, "kp1", json({ webhookUrl: "https://discord.com/api/webhooks/123456789012345678/abcdefghijklmnopqrstuvwxyz_-ABC" }));
    const kp = await join(a.id, "kp1");
    const backup = await call("GET", `/rooms/${a.id}/export?format=backup&sheets=1`, "kp1");
    expect(backup.status).toBe(200);
    expect(backup.json.format).toBe("roll-and-call-backup");
    expect(backup.text).not.toContain("abcdefghij");
    expect(backup.text).not.toContain("kp1");
    expect(backup.json.characters.length).toBeGreaterThan(0);
    const noSheets = await call("GET", `/rooms/${a.id}/export?format=backup`, "kp1");
    expect(noSheets.json.characters).toHaveLength(0);
    kp.ws.close();

    const b = await call("POST", "/rooms/import", "kp1", backup.text);
    expect(b.status).toBe(201);
    expect(b.json.id).not.toBe(a.id);
    const again = await call("GET", `/rooms/${b.json.id}/export?format=backup&sheets=1`, "kp1");
    expect(again.json.scenes.map((s: { name: string }) => s.name)).toEqual(backup.json.scenes.map((s: { name: string }) => s.name));
    const bgA = backup.json.media && Object.keys(backup.json.media);
    expect(bgA?.length).toBeGreaterThan(0);

    expect((await call("DELETE", `/rooms/${a.id}`, "kp1")).status).toBeLessThan(300);
    const other = await call("GET", `/rooms/${b.json.id}/export?format=scenario`, "kp1");
    expect(Object.keys(other.json.media ?? {}).length).toBeGreaterThan(0);
  });

  it("룸 이름을 주인이 바꿔요", async () => {
    const room = (await call("POST", "/rooms", "kp1", json({ name: "저택" }))).json;
    const r = await call("PATCH", `/rooms/${room.id}`, "kp1", json({ name: "  새 이름  " }));
    expect(r.status).toBe(200);
    expect(r.json.name).toBe("새 이름");
    expect((await call("PATCH", `/rooms/${room.id}`, "kp1", json({ name: "   " }))).status).toBe(400);
  });
});
