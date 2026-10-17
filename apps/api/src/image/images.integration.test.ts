import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { WsAdapter } from "@nestjs/platform-ws";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppModule } from "../app.module";
import { FileImageStorage } from "./infrastructure/file-image.storage";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
let app: INestApplication;
let base: string;
let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "img-"));
  const ref = await Test.createTestingModule({
    imports: [AppModule.register({ images: new FileImageStorage(dir), imageOptions: { maxUploads: 3 } })],
  }).compile();
  app = ref.createNestApplication();
  app.useWebSocketAdapter(new WsAdapter(app));
  await app.listen(0);
  base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
});
afterEach(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const upload = (body: Buffer | string, user: string | null = "pl1", type = "image/png") =>
  fetch(`${base}/images`, { method: "POST", headers: { "content-type": type, ...(user ? { "x-dev-user": user } : {}) }, body: typeof body === "string" ? body : new Uint8Array(body) });

describe("이미지 올리기와 보기", () => {
  it("올린 이미지를 로그인 없이 같은 형식으로 볼 수 있다", async () => {
    const r = await upload(PNG);
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as { id: string };
    expect(id).toMatch(/^[a-f0-9]{32}$/);
    const got = await fetch(`${base}/images/${id}`);
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("image/png");
    expect(got.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await got.arrayBuffer()).equals(PNG)).toBe(true);
    expect(readdirSync(dir)).toEqual([`${id}.png`]);
  });

  it("로그인하지 않으면 올릴 수 없다", async () => {
    expect((await upload(PNG, null)).status).toBe(401);
  });

  it("이미지가 아닌 파일은 이름이나 형식을 속여도 거절한다 (SVG 포함)", async () => {
    expect((await upload("<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>", "pl1", "image/png")).status).toBe(400);
    expect((await upload(Buffer.from("hello world"), "pl1", "image/png")).status).toBe(400);
    expect((await upload(Buffer.alloc(0))).status).toBe(400);
  });

  it("3MB를 넘으면 거절한다", async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]);
    expect((await upload(big)).status).toBe(413);
  });

  it("한 사람이 연달아 많이 올리면 제한한다", async () => {
    for (let i = 0; i < 3; i++) expect((await upload(PNG)).status).toBe(201);
    expect((await upload(PNG)).status).toBe(429);
    expect((await upload(PNG, "pl2")).status).toBe(201);
  });

  it("없는 id와 경로 조작은 404", async () => {
    expect((await fetch(`${base}/images/${"0".repeat(32)}`)).status).toBe(404);
    expect((await fetch(`${base}/images/..%2F..%2Fetc%2Fpasswd`)).status).toBe(404);
  });

  it("오디오는 /audio로 올리고 받으며, 이미지 주소로는 꺼낼 수 없다", async () => {
    const mp3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(64, 7)]);
    const up = (body: Buffer, user: string | null = "kp1") =>
      fetch(`${base}/audio`, { method: "POST", headers: { "content-type": "audio/mpeg", ...(user ? { "x-dev-user": user } : {}) }, body: new Uint8Array(body) });
    const r = await up(mp3);
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as { id: string };
    const got = await fetch(`${base}/audio/${id}`);
    expect(got.status).toBe(200);
    expect(got.headers.get("content-type")).toBe("audio/mpeg");
    expect(Buffer.from(await got.arrayBuffer()).equals(mp3)).toBe(true);
    expect((await fetch(`${base}/images/${id}`)).status).toBe(404);
    expect(readdirSync(dir)).toContain(`${id}.mp3`);

    const png = (await (await upload(PNG)).json()) as { id: string };
    expect((await fetch(`${base}/audio/${png.id}`)).status).toBe(404);

    expect((await up(PNG)).status).toBe(400); // 이미지는 오디오로 올릴 수 없다
    expect((await up(mp3, null)).status).toBe(401);
    for (const head of [Buffer.from("OggS"), Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE")]), Buffer.concat([Buffer.alloc(4), Buffer.from("ftypM4A ")])]) {
      expect((await up(Buffer.concat([head, Buffer.alloc(16)]), "kp2")).status).toBe(201);
    }
  });
});
