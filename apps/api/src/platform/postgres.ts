import { Pool } from "pg";

/** 어댑터가 쓰는 최소한의 DB 접근. 테스트에서 바꿔 끼우기 쉽도록 pg 타입을 밖으로 내보내지 않는다. */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface ClosableDb extends Db {
  close(): Promise<void>;
}

export function connectPostgres(url: string): ClosableDb {
  const pool = new Pool({ connectionString: url, max: 10 });
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
`;

export async function migrate(db: Db): Promise<void> {
  await db.query(SCHEMA);
}
