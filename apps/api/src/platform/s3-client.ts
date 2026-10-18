import { signRequest, payloadHash, uriEncode } from "./sigv4";

/** S3 호환 저장소(AWS S3, Cloudflare R2, MinIO)에 필요한 최소 호출. fetch를 바꿔 끼울 수 있어 프로세스 안에서 시험한다. */

export type S3Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: Buffer; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}>;

export interface S3ClientOptions {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
  fetch?: S3Fetch;
  now?: () => Date;
  timeoutMs?: number;
  /** 네트워크 오류·5xx에서 다시 시도하는 횟수(기본 2) */
  retries?: number;
}

export class S3Error extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface S3Object {
  key: string;
  lastModified: number;
  size: number;
}

const decodeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const tag = (xml: string, name: string) => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? decodeXml(m[1] as string) : undefined;
};

export class S3Client {
  private readonly doFetch: S3Fetch;
  private readonly retries: number;
  private readonly timeoutMs: number;

  constructor(private readonly o: S3ClientOptions) {
    this.doFetch = o.fetch ?? ((url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<S3Fetch>);
    this.retries = o.retries ?? 2;
    this.timeoutMs = o.timeoutMs ?? 15_000;
  }

  private url(key: string, query?: Record<string, string>): URL {
    const base = new URL(this.o.endpoint ?? `https://s3.${this.o.region}.amazonaws.com`);
    const encKey = key.split("/").map((s) => uriEncode(s)).join("/");
    // 경로 방식은 endpoint가 있을 때의 기본. 없으면(AWS) 가상 호스트 방식을 쓴다.
    const pathStyle = this.o.forcePathStyle ?? Boolean(this.o.endpoint);
    const u = pathStyle ? new URL(`${base.origin}${base.pathname.replace(/\/$/, "")}/${uriEncode(this.o.bucket)}/${encKey}`) : new URL(`${base.protocol}//${this.o.bucket}.${base.host}/${encKey}`);
    for (const [k, v] of Object.entries(query ?? {})) u.searchParams.set(k, v);
    return u;
  }

  private async call(method: string, key: string, opts: { query?: Record<string, string>; body?: Buffer; headers?: Record<string, string> } = {}) {
    let last: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const url = this.url(key, opts.query);
      const headers = signRequest({
        method,
        url,
        headers: opts.headers,
        payloadHash: payloadHash(opts.body),
        accessKeyId: this.o.accessKeyId,
        secretAccessKey: this.o.secretAccessKey,
        region: this.o.region,
        date: this.o.now?.(),
      });
      delete headers.host; // fetch가 알아서 넣는다.
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
      try {
        const res = await this.doFetch(url.toString(), { method, headers, body: opts.body, signal: ctl.signal });
        if (res.status >= 500 && attempt < this.retries) {
          last = new S3Error(res.status, `S3 ${method} ${res.status}`);
          continue;
        }
        return res;
      } catch (e) {
        last = e;
        if (attempt >= this.retries) break;
      } finally {
        clearTimeout(timer);
      }
      await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
    }
    throw last instanceof Error ? last : new Error(String(last));
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const res = await this.call("PUT", key, { body, headers: { "content-type": contentType } });
    if (!res.ok) throw new S3Error(res.status, `S3 PUT ${res.status}`);
  }

  /** 없으면 null */
  async get(key: string): Promise<{ bytes: Buffer; contentType: string | null } | null> {
    const res = await this.call("GET", key);
    if (res.status === 404) return null;
    if (!res.ok) throw new S3Error(res.status, `S3 GET ${res.status}`);
    return { bytes: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") };
  }

  /** 없는 키여도 성공(204) */
  async delete(key: string): Promise<void> {
    const res = await this.call("DELETE", key);
    if (!res.ok && res.status !== 404) throw new S3Error(res.status, `S3 DELETE ${res.status}`);
  }

  /** prefix 아래의 모든 객체를 쪽 단위로 돌려준다(ListObjectsV2). */
  async *list(prefix: string): AsyncGenerator<S3Object> {
    let token: string | undefined;
    do {
      const query: Record<string, string> = { "list-type": "2", prefix };
      if (token) query["continuation-token"] = token;
      const res = await this.call("GET", "", { query });
      if (!res.ok) throw new S3Error(res.status, `S3 LIST ${res.status}`);
      const xml = await res.text();
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const c = m[1] as string;
        const key = tag(c, "Key");
        if (!key) continue;
        yield { key, lastModified: Date.parse(tag(c, "LastModified") ?? "") || 0, size: Number(tag(c, "Size") ?? 0) };
      }
      token = tag(xml, "IsTruncated") === "true" ? tag(xml, "NextContinuationToken") : undefined;
    } while (token);
  }
}
