import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { S3Client } from "../../platform/s3-client";
import { S3ImageStorage } from "./s3-image.storage";
import { startFakeS3, type FakeS3 } from "./fake-s3";

const CREDS = { bucket: "vtt-images", region: "auto", accessKeyId: "AKIATESTKEY", secretAccessKey: "test/secret/key" };
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const id = (n: number) => n.toString(16).padStart(32, "0");

let fake: FakeS3;
const make = (over: { secretAccessKey?: string; prefix?: string; retries?: number; timeoutMs?: number } = {}) =>
  new S3ImageStorage(
    new S3Client({ ...CREDS, secretAccessKey: over.secretAccessKey ?? CREDS.secretAccessKey, endpoint: fake.url, forcePathStyle: true, retries: over.retries ?? 2, timeoutMs: over.timeoutMs }),
    over.prefix ?? "img",
  );

beforeEach(async () => {
  fake = await startFakeS3({ ...CREDS, pageSize: 2 });
});
afterEach(async () => {
  await fake.close();
});

describe("S3ImageStorage (가짜 S3)", () => {
  it("올리고 읽고 지운다. 형식은 Content-Type에 남는다", async () => {
    const s = make();
    await s.put(id(1), { bytes: PNG, mime: "image/png" });
    expect(fake.objects.get(`img/${id(1)}`)?.contentType).toBe("image/png");
    const got = await s.get(id(1));
    expect(got?.mime).toBe("image/png");
    expect(got?.bytes.equals(PNG)).toBe(true);
    await s.remove(id(1));
    expect(await s.get(id(1))).toBeNull();
    await s.remove(id(1)); // 없는 파일을 또 지워도 괜찮다
  });

  it("오디오도 같은 방식으로 저장한다", async () => {
    const s = make();
    const mp3 = Buffer.from("ID3....");
    await s.put(id(2), { bytes: mp3, mime: "audio/mpeg" });
    expect((await s.get(id(2)))?.mime).toBe("audio/mpeg");
  });

  it("없는 파일은 null", async () => {
    expect(await make().get(id(9))).toBeNull();
  });

  it("모양이 다른 id는 요청을 보내지 않고 거절한다", async () => {
    const s = make();
    await expect(s.put("../etc/passwd", { bytes: PNG, mime: "image/png" })).rejects.toThrow();
    expect(await s.get("../x")).toBeNull();
    await s.remove("../x");
    expect(fake.requests).toHaveLength(0);
  });

  it("형식을 알 수 없는 객체는 돌려주지 않는다", async () => {
    fake.objects.set(`img/${id(3)}`, { body: Buffer.from("<script>"), contentType: "text/html", lastModified: Date.now() });
    expect(await make().get(id(3))).toBeNull();
  });

  it("list는 쪽을 넘겨 모든 파일의 id와 시각을 준다(prefix 밖은 제외)", async () => {
    const s = make();
    for (let i = 1; i <= 5; i++) await s.put(id(i), { bytes: PNG, mime: "image/png" });
    fake.objects.set("other/" + id(99), { body: PNG, contentType: "image/png", lastModified: 1 });
    fake.objects.set("img/not-an-id", { body: PNG, contentType: "image/png", lastModified: 1 });
    const seen: string[] = [];
    for await (const f of s.list()) {
      expect(f.createdAt).toBeGreaterThan(0);
      seen.push(f.id);
    }
    expect(seen).toEqual([1, 2, 3, 4, 5].map(id));
  });

  it("잘못된 비밀 키는 서명 오류(403)로 실패한다", async () => {
    const s = make({ secretAccessKey: "wrong" });
    await expect(s.put(id(1), { bytes: PNG, mime: "image/png" })).rejects.toThrow(/403/);
    expect(fake.objects.size).toBe(0);
  });

  it("5xx는 다시 시도해서 성공한다", async () => {
    const s = make();
    fake.failNext = 2;
    await s.put(id(1), { bytes: PNG, mime: "image/png" });
    expect(fake.objects.has(`img/${id(1)}`)).toBe(true);
  });

  it("계속 실패하면 던진다(호출한 쪽이 처리)", async () => {
    const s = make({ retries: 1 });
    fake.failNext = 10;
    await expect(s.get(id(1))).rejects.toThrow(/500/);
  });

  it("서버가 응답하지 않으면 제한 시간 뒤 실패한다", async () => {
    const s = new S3ImageStorage(new S3Client({ ...CREDS, endpoint: "http://127.0.0.1:9", forcePathStyle: true, retries: 0, timeoutMs: 200 }));
    await expect(s.get(id(1))).rejects.toThrow();
  });

  it("prefix 없이도 동작한다", async () => {
    const s = make({ prefix: "" });
    await s.put(id(4), { bytes: PNG, mime: "image/gif" });
    expect(fake.objects.has(id(4))).toBe(true);
  });
});
