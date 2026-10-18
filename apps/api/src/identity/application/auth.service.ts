import type { IncomingMessage } from "node:http";
import type { Authenticate, Identity } from "../domain/identity";

export class AuthService {
  constructor(private readonly authenticate: Authenticate) {}

  /** 인증 구현이 동기든 비동기(JWKS 조회)든 같은 길로 부른다. 던지면 인증 실패(null)로 본다. */
  async fromRequest(req: IncomingMessage): Promise<Identity | null> {
    try {
      return await this.authenticate(req, new URL(req.url ?? "/", "http://localhost"));
    } catch {
      return null;
    }
  }
}
