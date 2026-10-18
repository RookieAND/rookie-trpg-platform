import type { IncomingMessage } from "node:http";

/** 요청 본문을 그대로 읽는다. 한도를 넘으면 읽던 것을 버리고 "too_large"를 돌려준다. */
export async function readBody(req: IncomingMessage, max: number): Promise<Buffer | "too_large"> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > max) return "too_large";
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const b = chunk as Buffer;
    size += b.length;
    if (size > max) return "too_large";
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}
