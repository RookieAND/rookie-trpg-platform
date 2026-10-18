-- 밤의 탁자 Postgres 스키마 (멱등: 여러 번 실행해도 안전합니다).
--
-- API 서버는 DATABASE_URL이 있으면 시작할 때 이 내용을 스스로 실행합니다(apps/api/src/platform/postgres.ts의 SCHEMA).
-- 그래서 직접 실행하지 않아도 됩니다. 다음 경우에 이 파일을 쓰세요.
--   - 서버 DB 계정에 CREATE 권한을 주고 싶지 않아 스키마를 미리 만들어 둘 때(Supabase SQL Editor에 붙여넣기)
--   - 변경 내용을 검토하거나 새 환경을 손으로 준비할 때
-- 이 파일과 코드의 SCHEMA는 시험(postgres.test.ts)이 같은 내용인지 확인합니다.
-- 스키마를 바꾸면 이 파일도 같이 고치세요.

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
