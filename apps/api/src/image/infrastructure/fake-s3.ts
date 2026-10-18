import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { payloadHash, signRequest } from "../../platform/sigv4";

/** 시험용 가짜 S3(경로 방식). 서명을 실제로 다시 계산해 맞는지 확인하고, 목록은 maxKeys 단위로 쪽을 나눠 준다. */
export interface FakeS3 {
  url: string;
  objects: Map<string, { body: Buffer; contentType: string; lastModified: number }>;
  requests: Array<{ method: string; path: string }>;
  /** 이 횟수만큼 먼저 500을 돌려준다 */
  failNext: number;
  /** 모든 요청을 이 상태로 거절한다(예: 403) */
  forceStatus: number | null;
  close(): Promise<void>;
}

export async function startFakeS3(opts: { bucket: string; region: string; accessKeyId: string; secretAccessKey: string; pageSize?: number }): Promise<FakeS3> {
  const state: FakeS3 = { url: "", objects: new Map(), requests: [], failNext: 0, forceStatus: null, close: async () => {} };
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const url = new URL(req.url ?? "/", state.url);
      state.requests.push({ method: req.method ?? "", path: url.pathname });
      const reply = (status: number, text = "", headers: Record<string, string> = {}) => {
        res.writeHead(status, headers);
        res.end(text);
      };
      if (state.forceStatus) return reply(state.forceStatus, "<Error><Code>AccessDenied</Code></Error>");
      if (state.failNext > 0) {
        state.failNext -= 1;
        return reply(500, "<Error><Code>InternalError</Code></Error>");
      }
      // 서명 확인: 받은 헤더로 다시 계산해서 같은지 본다.
      const given = String(req.headers.authorization ?? "");
      const signedNames = /SignedHeaders=([^,]+)/.exec(given)?.[1]?.split(";") ?? [];
      const headers: Record<string, string> = {};
      for (const n of signedNames) if (!["host", "x-amz-date", "x-amz-content-sha256"].includes(n)) headers[n] = String(req.headers[n] ?? "");
      const expected = signRequest({
        method: req.method ?? "GET",
        url: new URL(`http://${req.headers.host}${req.url}`),
        headers,
        payloadHash: String(req.headers["x-amz-content-sha256"]),
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
        region: opts.region,
        amzDate: String(req.headers["x-amz-date"]),
      });
      if (expected.authorization !== given || req.headers["x-amz-content-sha256"] !== payloadHash(body.length ? body : undefined)) {
        return reply(403, "<Error><Code>SignatureDoesNotMatch</Code></Error>");
      }
      const m = new RegExp(`^/${opts.bucket}/?(.*)$`).exec(decodeURIComponent(url.pathname));
      if (!m) return reply(404, "<Error><Code>NoSuchBucket</Code></Error>");
      const key = m[1] as string;
      if (req.method === "PUT") {
        state.objects.set(key, { body, contentType: String(req.headers["content-type"] ?? "application/octet-stream"), lastModified: Date.now() });
        return reply(200);
      }
      if (req.method === "DELETE") {
        state.objects.delete(key);
        return reply(204);
      }
      if (req.method === "GET" && key === "" && url.searchParams.get("list-type") === "2") {
        const prefix = url.searchParams.get("prefix") ?? "";
        const all = [...state.objects].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1));
        const start = Number(url.searchParams.get("continuation-token") ?? 0);
        const size = opts.pageSize ?? 1000;
        const page = all.slice(start, start + size);
        const more = start + size < all.length;
        const xml =
          `<?xml version="1.0"?><ListBucketResult><IsTruncated>${more}</IsTruncated>` +
          (more ? `<NextContinuationToken>${start + size}</NextContinuationToken>` : "") +
          page.map(([k, o]) => `<Contents><Key>${k}</Key><LastModified>${new Date(o.lastModified).toISOString()}</LastModified><Size>${o.body.length}</Size></Contents>`).join("") +
          `</ListBucketResult>`;
        return reply(200, xml, { "content-type": "application/xml" });
      }
      if (req.method === "GET") {
        const o = state.objects.get(key);
        if (!o) return reply(404, "<Error><Code>NoSuchKey</Code></Error>");
        res.writeHead(200, { "content-type": o.contentType });
        return void res.end(o.body);
      }
      reply(405);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  state.close = () => new Promise((r) => server.close(() => r()));
  return state;
}
