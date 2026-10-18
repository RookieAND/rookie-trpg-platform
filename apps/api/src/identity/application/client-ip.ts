import type { IncomingMessage } from "node:http";

/**
 * 요청한 쪽 IP. 프록시 뒤가 아니면 소켓 주소만 믿는다.
 * hops가 1 이상이면 X-Forwarded-For의 오른쪽에서 hops번째를 쓴다
 * (왼쪽 값은 클라이언트가 마음대로 적을 수 있고, 오른쪽은 우리 프록시가 붙인다).
 */
export class ClientIpResolver {
  constructor(private readonly hops = 0) {}

  of(req: IncomingMessage): string {
    if (this.hops > 0) {
      const raw = req.headers["x-forwarded-for"];
      const list = (Array.isArray(raw) ? raw.join(",") : (raw ?? ""))
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const hit = list[list.length - this.hops];
      if (hit) return hit.slice(0, 64);
    }
    return req.socket?.remoteAddress ?? "unknown";
  }
}
