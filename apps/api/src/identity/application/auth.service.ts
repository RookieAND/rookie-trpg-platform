import type { IncomingMessage } from "node:http";
import type { Authenticate, Identity } from "../domain/identity";

export class AuthService {
  constructor(private readonly authenticate: Authenticate) {}

  fromRequest(req: IncomingMessage): Identity | null {
    return this.authenticate(req, new URL(req.url ?? "/", "http://localhost"));
  }
}
