import type { IncomingMessage } from "node:http";
import type { Role } from "@coc-vtt/shared";

/** 요청한 사람이 누구인지. 인증 방식(개발용/Supabase)과 무관한 도메인 값이다. */
export interface Identity {
  userId: string;
  name: string;
  /** 접속하려는 역할. 룸이 허락한 범위 안에서만 쓰인다. */
  requestedRole: Role;
  /** 로그인 토큰이 만료되는 시각(ms). 열려 있는 연결은 이 시각이 지나면 닫힌다. 개발용 인증에는 없다. */
  expiresAt?: number;
}

/** 요청에서 신원을 읽는 규칙(포트). 구현은 infrastructure에 둔다. */
export type Authenticate = (req: IncomingMessage, url: URL) => Identity | null | Promise<Identity | null>;
