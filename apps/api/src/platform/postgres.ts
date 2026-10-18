import { Pool } from "pg";
import { errFields, log } from "./log";

/** 어댑터가 쓰는 최소한의 DB 접근. 테스트에서 바꿔 끼우기 쉽도록 pg 타입을 밖으로 내보내지 않는다. */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface ClosableDb extends Db {
  close(): Promise<void>;
}

export interface PostgresOptions {
  /** off: TLS 끔 / no-verify: 암호화하되 인증서 검증 안 함 / verify: 검증(CA는 caCert 또는 시스템 기본). 없으면 접속 문자열을 따른다. */
  ssl?: "off" | "no-verify" | "verify";
  caCert?: string;
  max?: number;
  /** 연결을 얻는 데 기다리는 최대 시간(ms) */
  connectionTimeoutMs?: number;
  /** 쿼리 하나가 걸릴 수 있는 최대 시간(ms). 저장이 영원히 멈춰 뒤 저장까지 막는 일을 막는다. */
  queryTimeoutMs?: number;
  onError?: (e: unknown) => void;
}

/** `?sslmode=...`를 걷어낸다. 접속 문자열의 sslmode가 ssl 옵션을 덮어쓰지 않게 한다. */
export function stripSslMode(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete("sslmode");
    return u.toString();
  } catch {
    return url;
  }
}

export function connectPostgres(url: string, o: PostgresOptions = {}): ClosableDb {
  const ssl = o.ssl === "off" ? false : o.ssl === "no-verify" ? { rejectUnauthorized: false } : o.ssl === "verify" ? { rejectUnauthorized: true, ...(o.caCert ? { ca: o.caCert } : {}) } : undefined;
  const pool = new Pool({
    connectionString: ssl === undefined ? url : stripSslMode(url),
    ...(ssl === undefined ? {} : { ssl }),
    max: o.max ?? 10,
    connectionTimeoutMillis: o.connectionTimeoutMs ?? 10_000,
    idleTimeoutMillis: 30_000,
    query_timeout: o.queryTimeoutMs ?? 20_000,
    keepAlive: true,
  });
  // 놀고 있는 연결이 DB 쪽에서 끊기면 pool이 'error'를 낸다. 처리하지 않으면 프로세스가 죽는다.
  pool.on("error", (e) => (o.onError ? o.onError(e) : log.error("pg pool 오류(놀고 있는 연결)", errFields(e))));
  return {
    query: (text, params) => pool.query(text, params as unknown[]) as Promise<{ rows: never[] }>,
    close: () => pool.end(),
  };
}

/** 테이블이 없으면 만든다. 여러 번 불러도 안전하다. */
export const SCHEMA = `
create table if not exists rooms (
  id text primary key,
  owner_id text not null,
  member_ids text[] not null default '{}',
  meta jsonb not null,
  data jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists rooms_owner_idx on rooms (owner_id);
create index if not exists rooms_members_idx on rooms using gin (member_ids);

create table if not exists vaults (
  user_id text primary key,
  characters jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists libraries (
  user_id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table libraries add column if not exists revision integer not null default 0;

create table if not exists images (
  id text primary key,
  mime text not null,
  bytes bytea not null,
  created_at timestamptz not null default now()
);

-- Supabase는 public 테이블을 Data API(공개 anon 키)로도 열어 준다. RLS를 켜고 정책을 두지 않아 그 길로는 아무것도 못 읽게 한다.
-- 서버는 테이블 소유 계정으로 직접 접속하므로 영향을 받지 않는다.
alter table rooms enable row level security;
alter table vaults enable row level security;
alter table libraries enable row level security;
alter table images enable row level security;
`;

export async function migrate(db: Db): Promise<void> {
  await db.query(SCHEMA);
}
