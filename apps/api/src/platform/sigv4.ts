import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4 (Authorization 헤더 방식). S3와 Cloudflare R2가 같은 방식을 쓴다.
 * 외부 SDK(수 MB) 대신 필요한 만큼만 직접 구현했고, AWS 문서의 공개 예제 값으로 검증한다(sigv4.test.ts).
 */

const sha256hex = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 방식 퍼센트 인코딩. slash는 경로에서만 남긴다. */
export const uriEncode = (s: string, keepSlash = false) =>
  encodeURIComponent(s)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%2F/g, keepSlash ? "/" : "%2F");

export const EMPTY_SHA256 = sha256hex("");
export const payloadHash = (body: Buffer | string | undefined) => (body === undefined ? EMPTY_SHA256 : sha256hex(body));

export interface SignInput {
  method: string;
  url: URL;
  /** 서명에 넣을 헤더. host와 x-amz-date, x-amz-content-sha256은 여기서 채우므로 넣지 않아도 된다. */
  headers?: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service?: string;
  /** 서명 시각. 시험에서 고정한다. */
  date?: Date;
  /** 이미 헤더에 x-amz-date가 있으면 그 값을 쓴다(AWS 문서 예제 재현용). */
  amzDate?: string;
}

export function signRequest(i: SignInput): Record<string, string> {
  const service = i.service ?? "s3";
  const amzDate = i.amzDate ?? (i.date ?? new Date()).toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(i.headers ?? {})) headers[k.toLowerCase()] = v.trim().replace(/\s+/g, " ");
  headers.host = i.url.host;
  headers["x-amz-date"] = amzDate;
  headers["x-amz-content-sha256"] = i.payloadHash;

  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join("");
  const signedHeaders = names.join(";");
  const query = [...i.url.searchParams.entries()]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  // URL이 이미 인코딩한 경로를 그대로 쓰되, S3 규칙대로 한 번만 인코딩된 상태를 유지한다.
  const canonicalPath = i.url.pathname.split("/").map((seg) => uriEncode(decodeURIComponent(seg))).join("/") || "/";
  const canonical = [i.method.toUpperCase(), canonicalPath, query, canonicalHeaders, signedHeaders, i.payloadHash].join("\n");

  const scope = `${day}/${i.region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonical)].join("\n");
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${i.secretAccessKey}`, day), i.region), service), "aws4_request");
  const signature = createHmac("sha256", kSigning).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return headers;
}
