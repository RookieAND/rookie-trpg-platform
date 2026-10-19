# 배포 가이드

웹(Next.js)은 Vercel, API(HTTP + 웹소켓, 오래 도는 Node 서버)는 컨테이너 호스트(Fly.io / Render / Railway / 도커가 되는 아무 곳), 로그인과 DB는 Supabase, 이미지·오디오는 S3 호환 저장소(Cloudflare R2 등)에 두는 구성의 순서대로 따라가는 문서입니다.

```
브라우저 ──https──▶ Vercel (apps/web)
   │
   ├──https──▶ API 서버 (apps/api, 1대) ──▶ Supabase Postgres (룸·보관함·서재)
   │            └ wss://…/ws                └▶ R2/S3 (이미지·오디오)
   └──https──▶ Supabase Auth (디스코드 로그인)
```

> **API 서버는 반드시 1대만 띄웁니다.** 룸의 실시간 상태(접속자, 진행 중인 판정, 보드)는 서버 메모리에 있고, 저장소는 "마지막으로 저장한 모습"일 뿐입니다. 두 대를 띄우면 같은 룸이 서버마다 따로 열려 서로의 저장을 덮어쓰고, 접속자가 서로 다른 서버에 붙으면 같은 룸인데 서로 보이지 않습니다. 오토스케일, 무중단(블루/그린·카나리) 배포, 잠자는(슬립) 플랜은 쓰지 마세요. 배포·재시작 때는 접속이 잠깐 끊기고(아래 "배포와 재시작 때 일어나는 일"), 서버를 더 키워야 하면 같은 서버의 CPU·메모리를 키우는 방향(스케일 업)만 가능합니다. 여러 대로 늘리려면 룸을 서버에 고정하는 라우팅과 서버 간 중계가 필요한데, 아직 없습니다.

## 0. 준비물

- Supabase 계정, Discord 계정(개발자 포털), Vercel 계정, 컨테이너 호스트 계정, Cloudflare 계정(R2) 또는 AWS(S3)
- 웹 도메인(예: `vtt.example.com`)과 API 도메인(예: `api.vtt.example.com`). 기본 도메인(`*.vercel.app`, `*.fly.dev`)으로도 되지만 아래 주소를 그에 맞게 바꿔 읽으세요.
- 이 저장소의 `main`(또는 배포할 브랜치)

각 단계의 값은 마지막에 모아 두었습니다([환경변수 전체표](#6-환경변수-전체표)).

## 1. Supabase (로그인 + Postgres)

### 1-1. 프로젝트 만들기

1. Supabase 대시보드에서 새 프로젝트를 만듭니다. 리전은 API 서버와 같은 권역(한국이면 Seoul 또는 Tokyo)을 고릅니다.
2. 데이터베이스 비밀번호를 정해 안전한 곳에 적어 둡니다(나중에 `DATABASE_URL`에 들어갑니다).
3. **Project Settings → API**에서 두 값을 적어 둡니다.
   - `Project URL` → `SUPABASE_URL`(API), `NEXT_PUBLIC_SUPABASE_URL`(웹). 예: `https://abcdxyz.supabase.co`
   - 공개 키(`anon` 또는 `publishable`) → `NEXT_PUBLIC_SUPABASE_ANON_KEY`(웹). 토큰 자동 갱신에만 쓰이고 공개돼도 괜찮은 값입니다. **`service_role` / `secret` 키는 어디에도 넣지 않습니다.**

### 1-2. 토큰 검증 방식 정하기

서버는 로그인 토큰(JWT)의 서명을 직접 검증합니다. 토큰 헤더의 `alg`를 보고 방식을 고르므로 둘을 함께 켜 둬도 됩니다.

| 프로젝트의 서명 키 | 서버 설정 |
| --- | --- |
| **비대칭 키 (ES256 / RS256)** — 새 프로젝트의 기본, **JWT Signing Keys** | `SUPABASE_URL`만 설정. 서버가 `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`에서 공개키를 받아 10분 캐시하고, 키가 교체되면(모르는 `kid`) 자동으로 다시 받습니다 |
| **레거시 공유 비밀 (HS256)** — Project Settings → JWT Keys → Legacy JWT Secret | `SUPABASE_JWT_SECRET`을 설정 |

확인 방법: Supabase 대시보드 **Project Settings → JWT Keys**에서 "Current key"의 종류를 봅니다. ECC(P-256)/RSA면 비대칭, "Legacy HS256"이면 공유 비밀입니다. 키를 비대칭으로 옮기는 중이라면 둘 다 설정해 두세요. 이전 토큰(HS256)과 새 토큰(ES256)을 모두 받습니다.

서버는 `iss`(`<SUPABASE_URL>/auth/v1`)와 `aud`(`authenticated`)도 확인합니다. `SUPABASE_URL` 없이 `SUPABASE_JWT_SECRET`만 쓰면 `iss`는 검사하지 않습니다.

### 1-3. Discord 로그인 연결

1. [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. **OAuth2** 메뉴에서 `Client ID`와 `Client Secret`을 확인합니다.
3. 같은 **OAuth2 → Redirects**에 Supabase 콜백 주소를 추가합니다.
   `https://<프로젝트 ref>.supabase.co/auth/v1/callback`
4. Supabase 대시보드 **Authentication → Sign In / Providers → Discord**를 켜고 `Client ID`, `Client Secret`을 붙여 넣습니다.
5. **Authentication → URL Configuration**
   - **Site URL**: 웹 주소 `https://vtt.example.com`
   - **Redirect URLs**: `https://vtt.example.com/auth/callback`
   - 개발용으로 `http://localhost:3000/auth/callback`도 추가해 둘 수 있습니다. (Vercel 미리보기 배포 주소로도 로그인하려면 그 주소의 `/auth/callback`도 추가해야 합니다. 와일드카드는 `https://*-내팀.vercel.app/auth/callback`처럼 쓸 수 있습니다.)
6. 이 앱은 로그인 뒤 `#access_token=…` 형태로 돌아오는 방식(implicit)을 읽습니다. Supabase 기본값 그대로 두세요.

### 1-4. Postgres 접속 문자열

**Project Settings → Database → Connection string**에서 고릅니다.

| 방식 | 언제 | 비고 |
| --- | --- | --- |
| **Session pooler** (포트 5432, 호스트 `aws-0-…pooler.supabase.com`, 사용자 `postgres.<ref>`) | **권장.** API 서버는 오래 사는 프로세스입니다 | IPv4로 접속됩니다. Render·일부 호스트는 IPv6 외부 접속이 안 되므로 이쪽이 안전합니다 |
| Direct connection (`db.<ref>.supabase.co:5432`) | 호스트가 IPv6를 지원할 때 | Fly.io는 가능, Render·Railway는 확인 필요 |
| Transaction pooler (포트 6543) | 서버리스용. 이 서버에는 불필요 | 쓸 수는 있습니다(이 서버는 prepared statement를 쓰지 않습니다) |

이 값이 `DATABASE_URL`입니다. 비밀번호가 들어 있으니 시크릿으로만 넣습니다.

**TLS.** pg 라이브러리는 `sslmode=require`를 인증서 검증(`verify-full`)으로 읽는데, Supabase 접속 서버의 인증서는 공인 CA가 아니라 Supabase 자체 CA라 그대로는 `self-signed certificate in certificate chain`으로 실패할 수 있습니다. 둘 중 하나로 해결합니다.

- 간단: `DATABASE_SSL=no-verify` — 연결은 암호화되지만 서버 인증서는 확인하지 않습니다.
- 엄격: `DATABASE_SSL=verify` + `DATABASE_CA_CERT`에 Supabase가 내려주는 CA 인증서(PEM 전체, Project Settings → Database → SSL Configuration에서 다운로드)를 넣습니다.

`DATABASE_SSL`을 쓰면 접속 문자열의 `sslmode=` 값은 무시됩니다. (이 부분은 실제 Supabase 프로젝트로 확인하지 못했습니다. 첫 배포에서 `/ready`가 200인지 꼭 보세요.)

### 1-5. 테이블

**따로 만들 필요 없습니다.** 서버가 시작할 때 `DATABASE_URL`이 있으면 필요한 테이블을 스스로 만듭니다(`create table if not exists …`라서 몇 번을 시작해도 안전합니다). 만들어지는 테이블: `rooms`, `vaults`, `libraries`, `images`.

DB 계정에 `CREATE` 권한을 주고 싶지 않거나 변경 내용을 검토하고 싶으면 [`deploy/schema.sql`](../deploy/schema.sql)을 Supabase **SQL Editor**에서 먼저 실행하세요. 서버가 스스로 만드는 것과 같은 내용입니다.

Supabase는 `public` 테이블을 공개 키(Data API)로도 열어 주기 때문에, 위 스키마는 네 테이블 모두 **Row Level Security를 켜고 정책을 두지 않습니다**. 즉 `anon`/`authenticated` 키로는 아무것도 읽거나 쓸 수 없고, 서버는 DB 소유 계정으로 직접 접속하므로 영향을 받지 않습니다. 이미 만든 테이블을 손으로 지웠다가 다시 만든 경우 이 설정이 빠지지 않았는지 확인하세요(Table Editor에서 "RLS enabled" 표시).

## 2. 이미지·오디오 저장소 (Cloudflare R2)

`S3_BUCKET`을 설정하지 않으면 이미지는 DB(`images` 테이블, 파일당 3MB 이하 bytea)에 쌓입니다. 개인 테이블이라면 그것으로 충분하지만, 쌓이면 DB 용량과 백업 크기가 커지므로 운영에서는 R2/S3를 권장합니다.

1. Cloudflare 대시보드 **R2 → Create bucket**. 이름 예: `coc-vtt-media`. 위치는 가까운 곳(APAC) 또는 자동.
2. 버킷은 **비공개 그대로** 둡니다(Public access 끔, `r2.dev` 공개 주소 켜지 않음). 파일은 브라우저가 버킷에서 직접 받지 않고 **API 서버(`/images/:id`, `/audio/:id`)가 읽어서 돌려줍니다.** 그래서 버킷에 CORS 설정이 필요 없고, 접근 규칙은 지금과 같이 서버가 쥐고 있습니다. (브라우저가 R2 주소에 직접 접근하지 않으므로 R2 CORS는 비워 둡니다.)
3. **R2 → Manage API tokens → Create API token**: 권한 `Object Read & Write`, 이 버킷만 지정. 나오는 `Access Key ID`, `Secret Access Key`를 적어 둡니다(한 번만 보입니다).
4. **S3 API 주소**는 `https://<계정 ID>.r2.cloudflarestorage.com`입니다(R2 개요 화면에 계정 ID가 있습니다).
5. API 서버 환경변수:

   ```
   S3_ENDPOINT=https://<계정 ID>.r2.cloudflarestorage.com
   S3_BUCKET=coc-vtt-media
   S3_ACCESS_KEY_ID=…        (시크릿)
   S3_SECRET_ACCESS_KEY=…    (시크릿)
   # S3_REGION은 비우면 auto (R2). AWS S3면 ap-northeast-2 같은 실제 리전을 적고 S3_ENDPOINT는 비웁니다.
   # S3_PREFIX=media         (한 버킷을 다른 용도와 나눠 쓸 때. 선택)
   ```

- 객체 키는 `<S3_PREFIX>/<서버가 만든 무작위 32자리 id>`이고 형식(Content-Type)은 객체 메타데이터에 적힙니다.
- AWS S3도 같은 설정으로 됩니다(`S3_ENDPOINT` 비움, `S3_REGION` 지정). MinIO 등 S3 호환 서버는 `S3_ENDPOINT`와 `S3_FORCE_PATH_STYLE=1`.
- R2를 쓰는 중에 `S3_BUCKET`을 빼면 이미지가 DB 쪽으로 바뀌어 **기존 이미지가 모두 보이지 않게 됩니다.** 저장소를 바꿀 때는 파일을 옮기는 도구가 없으니 새로 올려야 한다고 생각하세요.
- 이 어댑터는 실제 R2/S3로 확인하지 못했습니다(서명 계산은 AWS 문서의 공개 예제 값으로, 요청 흐름은 가짜 S3 서버로 시험). 첫 배포에서 이미지를 올려 보고, R2 대시보드에 객체가 생기는지 보세요.

### 쓰이지 않는 파일 정리

룸을 지우면 그 룸이 쓰던 파일은 함께 지워집니다. 그래도 올리기만 하고 룸에 저장되지 않은 파일, 서버가 중간에 죽어 못 지운 파일은 남습니다. 주기적으로 치우는 명령이 있습니다.

```bash
# 컨테이너 안, 또는 같은 환경변수(DATABASE_URL, S3_*)를 준 곳에서
node dist/cleanup-images.js --dry-run          # 지울 목록만 본다
node dist/cleanup-images.js --days 7           # 지운다
node dist/cleanup-images.js --days 7 --max-delete 500
# 저장소에서는: pnpm build:api && pnpm cleanup:images --dry-run
```

- 저장된 어떤 룸도 가리키지 않고 **올린 지 `--days`일(기본 7)이 지난** 파일만 지웁니다. 방금 올리고 아직 룸에 저장 전인 파일은 건드리지 않습니다.
- 룸이 하나도 없는데 파일만 있으면(엉뚱한 DB에 연결했을 가능성) 아무것도 지우지 않고 종료 코드 3으로 멈춥니다. `--max-delete`를 넘는 양을 지우게 되어도 같습니다.
- 처음에는 반드시 `--dry-run`으로 목록을 보세요. 주 1회 정도 스케줄(Render cron, Railway cron, Fly 예약 머신, GitHub Actions)로 돌리면 됩니다. `deploy/render.yaml`에 예시가 있습니다.

## 3. API 서버 배포

### 3-1. 이미지 만들기 확인 (로컬)

```bash
pnpm install
pnpm build:api                  # apps/api/dist/main.js 하나로 묶임 (shared, room-core 포함)
node scripts/smoke-prod.mjs     # 빌드한 서버를 production 모드로 띄워 로그인·룸·ws·종료를 확인
docker build -t coc-vtt-api .   # 저장소 루트에서
```

`Dockerfile`은 2단계입니다. 빌드 단계에서 `pnpm build:api`와 `pnpm deploy --prod`로 운영 의존성만 뽑고, 실행 단계(`node:22-slim`)에는 `dist/`와 `node_modules`만 들어갑니다. `node` 사용자로 실행하고, `HEALTHCHECK`는 `/health`를 봅니다. 기본 `PORT`는 8080입니다.

### 3-2. 호스트별 설정 예시

[`deploy/`](../deploy) 폴더에 있습니다. 모두 **인스턴스 1개, 잠들지 않음, 종료 대기 10초 이상**이 공통 조건입니다.

| 호스트 | 파일 | 요점 |
| --- | --- | --- |
| Fly.io | `deploy/fly.toml` | `fly launch --no-deploy --copy-config` 후 `fly secrets set …`, `fly deploy`. `auto_stop_machines="off"`, 배포 전략은 `rolling`(1대를 그 자리에서 교체) |
| Render | `deploy/render.yaml` | Blueprint로 생성. 플랜은 `starter` 이상(무료는 잠듭니다). `numInstances: 1`, 헬스 체크 `/ready` |
| Railway | `deploy/railway.json` + `deploy/README.md` | Replicas 1. 환경변수는 대시보드에서 |
| 기타 도커 호스트 | `Dockerfile` | `docker run -p 8080:8080 --env-file …`. 앞단 프록시가 TLS를 처리해야 합니다 |

헬스 체크는 두 가지입니다.

- `GET /health` — 살아 있는지. 프로세스가 응답하면 항상 200이고, 본문의 `status`가 `ok` / `degraded` / `shutting_down`입니다. `db`(`ok`/`error`/`none`, 지연 시간), `rooms`, `connections`, `uptimeSec`, `version`, `saves`(저장 실패 횟수)가 들어 있고 비밀은 없습니다. DB가 잠깐 안 된다고 호스트가 서버를 재시작하지 않도록 상태 코드는 바꾸지 않습니다. 모니터링은 `status`를 보세요.
- `GET /ready` — 손님을 받아도 되는지. 내려가는 중이거나 DB에 닿지 않으면 503입니다. 호스트의 "헬스 체크 경로"는 이쪽을 권장합니다.

### 쓰이지 않는 파일 자동 정리 (선택)

위 명령을 서버 안에서 주기적으로 돌리려면 `IMAGE_CLEANUP`을 켭니다. 기본은 꺼짐(`off`)입니다. `dry-run`은 지울 목록만 로그(`이미지 정리`)에 남기고, `on`은 실제로 지웁니다. 서버를 켠 지 10분 뒤 처음 돌고 이후 `IMAGE_CLEANUP_INTERVAL_HOURS`마다 돕니다. 안전장치(최근 N일 파일 보호, 룸이 하나도 없으면 중단, 한 번에 `IMAGE_CLEANUP_MAX_DELETE`개 초과 시 중단)는 명령과 같습니다. 처음에는 `dry-run`으로 며칠 지켜본 뒤 `on`으로 바꾸세요.

### 3-3. 프록시와 시간 제한

- **TLS / wss**: 호스트의 프록시(Fly, Render, Railway, Cloudflare)가 https/wss를 처리하고 서버에는 평문 http/ws로 넘깁니다. 서버는 `PORT` 하나로 HTTP와 웹소켓(`/ws`)을 함께 받으므로 프록시는 웹소켓 업그레이드만 통과시키면 됩니다.
- **`TRUST_PROXY=1`**: 프록시 1겹 뒤라면 반드시 설정하세요. 안 하면 모든 사용자가 프록시 IP 하나로 묶여 업로드·REST·웹소켓의 IP 한도를 함께 씁니다(운영에서 0이면 시작할 때 경고를 남기고, `X-Forwarded-For`가 붙은 요청이 오면 한 번 더 알립니다). Cloudflare → 호스트 프록시 → 서버처럼 2겹이면 `2`. 프록시 없이 직접 노출할 때는 켜지 마세요(헤더 위조로 한도를 피할 수 있습니다).
- **유휴 시간 제한**: 서버가 **30초마다 ping**을 보내고 직전 ping에 응답이 없으면 연결을 끊습니다(브라우저는 자동으로 pong을 보냅니다). 그래서 60초 유휴 제한이 있는 프록시(대부분의 호스트, Cloudflare는 100초)에서도 연결이 끊기지 않습니다. 프록시의 유휴 제한이 30초보다 짧게 설정돼 있다면 늘리세요.
- HTTP keep-alive는 65초로 맞춰 두었습니다(프록시의 60초 제한보다 길게. 재사용 연결에서 502가 나는 것을 막습니다).
- 요청 크기: 웹소켓 메시지 16KB, 이미지 3MB, 오디오 10MB, 시나리오 가져오기 12MB(품은 이미지·음원은 합쳐 9MB까지. 프록시의 본문 크기 제한이 이보다 작으면 올리세요). 그 밖의 JSON 요청은 100KB. 너무 크거나 깨진 본문은 413/400 JSON으로 답하고 오류 로그는 남기지 않습니다.

### 3-4. 시작 확인

서버는 시작할 때 JSON 한 줄을 남깁니다.

```json
{"level":"info","msg":"api started","port":8080,"rooms":"postgres","images":"s3(coc-vtt-media)","auth":"supabase(jwks)","env":"production","trustProxy":1,"webOrigin":"https://vtt.example.com"}
```

- `auth`가 `supabase(...)`여야 합니다. `dev(개발용)`이면 누구나 아무 사용자인 척할 수 있으니 즉시 내리세요.
- `rooms`가 `postgres`, `images`가 `s3(…)`인지 확인합니다.
- 뒤이어 `warn` 줄이 나오면 읽어 보세요(WEB_ORIGIN 누락, ALLOW_DEV_AUTH 등).
- `NODE_ENV=production`인데 `SUPABASE_URL`도 `SUPABASE_JWT_SECRET`도 없으면(그리고 `ALLOW_DEV_AUTH=1`도 아니면) 서버는 **시작을 거부**하고 종료 코드 1로 끝납니다.

로그는 한 줄에 JSON 하나(`t`, `level`, `msg`, 그 밖의 필드)입니다. `LOG_LEVEL`(`debug|info|warn|error`, 기본 `info`)로 조절합니다. 웹훅 주소, 토큰, `Bearer …`, `?token=`, 접속 문자열의 비밀번호, 액세스 키는 기록 직전에 가려집니다. 요청 주소는 `?` 뒤를 떼고 기록합니다.

## 4. 웹 배포 (Vercel)

1. Vercel에서 **Add New → Project**로 이 저장소를 가져옵니다.
2. 프로젝트 설정:

   | 항목 | 값 |
   | --- | --- |
   | Framework Preset | Next.js |
   | **Root Directory** | `apps/web` |
   | Install Command | 기본값(저장소 루트의 `pnpm-lock.yaml`을 보고 pnpm을 씁니다). Root Directory를 `apps/web`으로 해도 워크스페이스 전체를 설치합니다 |
   | Build Command | 기본값(`next build`) |
   | Output Directory | 기본값 |
   | Node.js Version | 22.x |
   | "Include source files outside of the Root Directory" | **켜기** (`packages/shared`를 쓰므로 필요합니다) |

3. **Environment Variables**(Production, 필요하면 Preview에도):

   | 이름 | 값 |
   | --- | --- |
   | `CSP_ENFORCE` | 아니오 | 꺼짐 | `1`이면 스크립트 CSP를 Report-Only 대신 차단 모드로 |
| `NEXT_PUBLIC_API_URL` | `https://api.vtt.example.com` (끝에 `/` 없이) |
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://abcdxyz.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 공개 키 |
   | `NEXT_PUBLIC_REALTIME_URL` | 보통 **비워 둡니다.** 비우면 API 주소에서 `wss://api.vtt.example.com/ws`를 만듭니다 |

   `NEXT_PUBLIC_*`는 **빌드할 때** 번들에 박힙니다. 값을 바꾸면 다시 배포(Redeploy)해야 합니다. Production 빌드에서 `NEXT_PUBLIC_API_URL`이 비어 있으면 빌드가 실패하도록 해 두었습니다(방문자의 localhost로 API를 부르는 사이트가 만들어지는 것을 막기 위해서입니다). `NEXT_PUBLIC_SUPABASE_URL`을 비우면 로그인 화면이 "개발용 이름 로그인"으로 바뀌는데, 운영 API가 그 로그인은 거절하므로 쓸 수 없는 사이트가 됩니다.

4. 도메인: **Settings → Domains**에 `vtt.example.com`을 추가하고 안내된 DNS(CNAME `cname.vercel-dns.com` 또는 A 레코드)를 설정합니다. API 도메인은 호스트 쪽에서 따로 연결합니다(Fly: `fly certs add api.vtt.example.com`, Render/Railway: Custom Domain). Cloudflare DNS를 쓴다면 API 도메인은 프록시(주황 구름)를 켜도 웹소켓이 됩니다(위의 유휴 시간 참고).
5. 배포 후 `https://vtt.example.com`에서 디스코드 로그인 → 룸 만들기까지 해 봅니다.

**웹 쪽 보안 설정**(`apps/web/next.config.mjs`에 들어 있습니다): `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`(초대 코드가 주소에 있으므로 다른 사이트로 새지 않게), `X-Frame-Options: DENY`와 `Content-Security-Policy: frame-ancestors 'none'`(다른 사이트가 iframe에 넣지 못하게), `Permissions-Policy`(카메라·마이크·위치 끔), `Strict-Transport-Security`. `X-Powered-By`는 숨깁니다. 전체 CSP(`script-src` 등)는 아직 걸지 않았습니다(Next 인라인 스크립트에 nonce가 필요해서 지금은 깨질 위험이 더 큽니다). 이 앱은 쿠키를 쓰지 않아서(로그인 토큰은 브라우저 저장소에 보관) 쿠키의 `Secure`/`SameSite` 설정 대상이 없습니다. CORS는 API 쪽에서 `WEB_ORIGIN` 한 주소만 허용합니다.

## 5. 마지막 연결: CORS와 주소 맞추기

세 곳의 주소가 서로 맞아야 합니다.

| 어디서 | 이름 | 값 |
| --- | --- | --- |
| API 서버 | `WEB_ORIGIN` | 웹 주소 `https://vtt.example.com` (스킴 포함, 끝에 `/` 없이, **한 개**) |
| Vercel | `NEXT_PUBLIC_API_URL` | API 주소 `https://api.vtt.example.com` |
| Supabase | Site URL / Redirect URLs | `https://vtt.example.com`, `https://vtt.example.com/auth/callback` |

`WEB_ORIGIN`은 한 주소만 받습니다. Vercel 미리보기 배포(`*.vercel.app`)에서 API를 부르면 CORS로 막힙니다. 미리보기용 API를 따로 두거나, 미리보기에서는 로컬 개발 API를 쓰세요.

## 6. 환경변수 전체표

### API (`apps/api`) — 예시 파일: `apps/api/.env.example`

"필수"는 production 기준입니다.

| 이름 | 필수 | 기본값 | 설명 / 예시 |
| --- | --- | --- | --- |
| `NODE_ENV` | 필수 | 개발로 취급 | `production`. 개발용 인증 차단과 설정 검증이 이 값에 달려 있습니다 |
| `PORT` | 호스트가 정함 | `8787` (Docker 이미지는 `8080`) | 1~65535 정수가 아니면 시작 거부 |
| `WEB_ORIGIN` | 필수 | `http://localhost:3000` | CORS로 허용할 웹 주소 한 개. `https://vtt.example.com` |
| `SUPABASE_URL` | 둘 중 하나 필수 | 없음 | `https://abcdxyz.supabase.co`. 있으면 JWKS(ES256/RS256)로 검증하고 `iss`를 확인 |
| `SUPABASE_JWT_SECRET` | 둘 중 하나 필수 | 없음 | 레거시 HS256 비밀. **시크릿** |
| `SUPABASE_JWT_AUD` | 아니오 | `authenticated` | 토큰 `aud` 검사 값 |
| `ALLOW_DEV_AUTH` | 아니오 | 꺼짐 | `1`이면 production에서도 개발용 인증(쿼리 `user`, 헤더 `x-dev-user`)을 씁니다. 위 두 값이 있으면 무시됩니다. **운영에서 켜지 마세요** |
| `DATABASE_URL` | 권장 | 없음 | `postgresql://postgres.<ref>:<비밀번호>@aws-0-….pooler.supabase.com:5432/postgres`. **시크릿**. 없으면 파일 저장 |
| `DATABASE_SSL` | 아니오 | 접속 문자열을 따름 | `no-verify` / `verify` / `off` (1-4 참고) |
| `DATABASE_CA_CERT` | `verify`일 때 | 없음 | CA 인증서 PEM 전체 |
| `DB_POOL_MAX` | 아니오 | `10` | DB 연결 수 상한(1~100). Supabase 무료 플랜의 연결 수 한도 안에서 |
| `DATA_DIR` | 아니오 | `./data` | `DATABASE_URL`이 없을 때만. 절대 경로 권장. `memory`는 재시작하면 모두 사라짐 |
| `S3_BUCKET` | 권장 | 없음 | 있으면 이미지·오디오를 S3 호환 저장소에. `coc-vtt-media` |
| `S3_ENDPOINT` | R2/MinIO면 필수 | AWS 기본 | `https://<계정 ID>.r2.cloudflarestorage.com` |
| `S3_REGION` | 아니오 | `auto` | AWS는 실제 리전 |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | 버킷이 있으면 필수 | 없음 | **시크릿** |
| `S3_FORCE_PATH_STYLE` | 아니오 | endpoint가 있으면 켜짐 | `1`/`0` |
| `S3_PREFIX` | 아니오 | 없음 | 객체 키 앞에 붙는 폴더 |
| `TRUST_PROXY` | 프록시 뒤면 | `0` | 프록시 겹 수(0~5) |
| `HTTP_RATE_LIMIT` | 아니오 | 켜짐 | `0`이면 REST 속도 제한을 끕니다. `/health`·`/ready`는 항상 제외 |
| `HTTP_RATE_IP_PER_MIN` | 아니오 | `1800` | IP당 분당 REST 요청 수(넘으면 429 + `Retry-After`) |
| `HTTP_RATE_USER_PER_MIN` | 아니오 | `900` | 로그인 토큰(개발용이면 사용자)당 분당 REST 요청 수 |
| `WS_MAX_CONNS_PER_USER` | 아니오 | `8` | 한 계정의 동시 웹소켓 수. 넘으면 가장 오래된 연결을 4412로 닫습니다 |
| `WS_MAX_CONNS_PER_IP` | 아니오 | `60` | 한 IP의 동시 웹소켓 수. 넘으면 새 연결을 4413으로 닫습니다 |
| `WS_MAX_CONNS_PER_ROOM` | 아니오 | `150` | 한 룸의 동시 웹소켓 수. 넘으면 4409 |
| `ROOM_IDLE_EVICT_MINUTES` | 아니오 | `30` | 접속자가 없는 룸을 저장한 뒤 메모리에서 내리기까지의 분(0이면 내리지 않음). 다시 들어오면 저장소에서 불러옵니다 |
| `IMAGE_CLEANUP` | 아니오 | `off` | `off` / `dry-run` / `on`. 쓰이지 않는 이미지 자동 정리(위 설명 참고) |
| `IMAGE_CLEANUP_INTERVAL_HOURS` | 아니오 | `24` | 자동 정리 간격 |
| `IMAGE_CLEANUP_MIN_AGE_DAYS` | 아니오 | `7` | 이보다 최근에 올린 파일은 건드리지 않음 |
| `IMAGE_CLEANUP_MAX_DELETE` | 아니오 | `500` | 한 번에 이보다 많이 지우게 되면 중단 |
| `APP_VERSION` | 아니오 | `package.json` 버전 | `/health`의 `version`. 배포 커밋 해시 등 |
| `LOG_LEVEL` | 아니오 | `info` | `debug` / `info` / `warn` / `error` |
| `KP_AWAY_GRACE_MS` | 아니오 | `30000` | GM 연결이 끊긴 뒤 세션이 자동 정지하기까지의 유예(ms) |
| `SHUTDOWN_TIMEOUT_MS` | 아니오 | `8000` | 종료(저장) 최대 대기. 호스트의 종료 대기 시간보다 짧게 |

### 웹 (`apps/web`) — 예시 파일: `apps/web/.env.example`

모두 빌드 시점 값입니다(바꾸면 재배포).

| 이름 | 필수 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | 필수 | `http://localhost:8787` | API 주소. 끝의 `/`는 자동으로 뗍니다 |
| `CSP_ENFORCE` | 아니오 | 꺼짐 | 서버(런타임) 값. `1`이면 스크립트 CSP를 Report-Only 대신 차단 모드로 |
| `NEXT_PUBLIC_REALTIME_URL` | 아니오 | API 주소에서 만듦 | `https`→`wss`로 바꾼 API 주소 + `/ws`. 따로 쓸 때만 지정 |
| `NEXT_PUBLIC_SUPABASE_URL` | 필수 | 없음 | 비우면 개발용 로그인 화면이 나옵니다 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 권장 | 없음 | 토큰 자동 갱신용 공개 키. 없으면 만료 시 다시 로그인 |
| `STRICT_PUBLIC_ENV` | 아니오 | 꺼짐 | `1`이면 Vercel이 아닌 곳에서도 `NEXT_PUBLIC_API_URL`이 비면 빌드 실패 |
| `WEB_URL`, `API_URL`, `CHROMIUM_PATH`, `E2E_*` | 아니오 | — | e2e 시험 전용. 배포와 무관 |

페이지가 https인데 웹소켓 주소가 `ws://`(로컬이 아님)면 브라우저가 막으므로 자동으로 `wss://`로 올려 접속합니다.

### 시크릿 취급

- **시크릿**으로만 넣을 것: `DATABASE_URL`, `SUPABASE_JWT_SECRET`, `S3_SECRET_ACCESS_KEY`(그리고 `S3_ACCESS_KEY_ID`). 저장소·이미지·로그에 넣지 않습니다. `/health`와 로그에는 나오지 않습니다.
- 웹 환경변수(`NEXT_PUBLIC_*`)는 브라우저에 그대로 공개됩니다. 비밀을 넣지 마세요.
- **디스코드 웹훅 URL은 평문으로 저장됩니다.** 룸 설정(`meta.discord.webhookUrl`)에 들어 있어 파일 저장이면 `DATA_DIR/<룸id>.json`, Postgres면 `rooms.meta`(jsonb)에 그대로 있습니다. 백업과 DB 덤프에도 포함되므로 같은 수준으로 보호하세요. 룸 주인 말고는 API가 돌려주지 않고(주인에게도 "연결됨" 여부만), 로그와 오류 응답에는 주소를 가려서([웹훅 주소]) 남깁니다. 유출이 의심되면 디스코드에서 웹훅을 삭제하고 새로 만드세요. 암호화 저장은 아직 없습니다.

## 7. 서버가 걸어 두는 한도

| 항목 | 값 |
| --- | --- |
| 웹소켓 메시지 | 연결당 버스트 120건, 초당 60건 보충. 넘기면 `rate_limited` 오류, 10초 안에 100번 넘게 거절되면 연결 종료(1008) |
| 웹소켓 하트비트 | 30초마다 ping, 직전 ping에 응답이 없으면 연결 종료 |
| 룸 | 계정당 20개까지, 시간당 10개까지 생성 |
| 이미지·오디오 업로드 | 계정당 종류별 시간당 30개, IP당 시간당 60개(이미지·오디오 합산) |
| 룸 삭제 | 룸 데이터가 참조하던 이미지·오디오 파일도 함께 삭제 |
| REST 요청 | IP당 분당 1800, 토큰당 분당 900(`HTTP_RATE_*`). `/health`·`/ready` 제외 |
| 웹소켓 연결 수 | 계정당 8(오래된 것을 4412로 닫음), IP당 60(4413), 룸당 150(4409) |
| 시나리오·백업 가져오기 | 본문 12MB(품은 파일 9MB·80개), 사용자당 시간당 40번(미리보기 포함), 동시에 한 번에 한 건, 서버 전체 동시 4건. 룸당 이미지·음원 200개 |
| 이미지 | 한 변 8000px·4천만 화소 이하(PNG/JPEG/GIF/WEBP 머리글을 서버가 직접 읽어 확인). 업로드와 가져오기가 사용자당 시간당 60MB를 함께 씀 |
| 디스코드 | 시험 전송 룸당 분당 3번, 설정 변경 룸당 분당 10번 |

### 접속 거절·종료 코드

| 코드 | 뜻 |
| --- | --- |
| 4401 | 로그인 필요/토큰 만료(웹은 토큰을 새로 받아 다시 붙음) |
| 4403 / 4404 | 권한 없음 / 룸 없음 |
| 4408 | 참가 메시지를 제때 보내지 않음(다시 시도) |
| 4409 | 룸 정원 또는 룸 연결 수 가득 참 |
| 4410 | 룸에서 내보냄(차단 없이) |
| 4411 | 룸에서 차단됨 |
| 4412 | 같은 계정의 연결이 너무 많아 오래된 연결을 닫음 |
| 4413 | 같은 IP의 연결이 너무 많음 |

## 7-1. 보안·데이터 보관

- **로그인 토큰은 주소에 싣지 않습니다.** 웹은 연결 직후 첫 메시지 `{type:"auth",data:{token}}`로 보냅니다(옛 방식인 `?token=`과 개발용 `?user=`도 받습니다). 토큰이 만료되면 서버가 하트비트에서 4401로 닫고, 웹은 새 토큰을 받아 다시 붙습니다. 프록시 로그에 토큰이 남지 않게 하려면 새 웹을 쓰세요.
- **차단 목록**은 룸 데이터(`bans`)에 저장되며 룸 주인·GM이 풀 수 있습니다(최대 100명). 스키마 버전은 4입니다.
- **보관 기간**: 대화·귓속말은 마지막 500개, 세션 기록은 최근 2000건까지 룸 데이터에 저장되고, 룸을 지우기 전에는 사라지지 않습니다. 룸 주인은 `DELETE /rooms/:roomId/history?scope=chat|log|all`(웹: GM 메뉴의 "안전·기록")로 언제든 비울 수 있고, 비우면 접속 중인 화면과 저장된 데이터에서 함께 지워집니다(백업·DB 덤프에 이미 들어간 복사본은 그대로입니다). 디스코드로 보낸 알림은 디스코드 쪽에 남습니다.
- **웹 CSP**: `apps/web/src/middleware.ts`가 요청마다 nonce를 만들어 `script-src 'self' 'nonce-…' 'strict-dynamic'`을 **Report-Only**로 겁니다(브라우저 콘솔에 위반만 표시). 위반이 없는 것을 확인한 뒤 웹 환경변수 `CSP_ENFORCE=1`로 차단 모드로 바꾸세요. 개발 서버는 `'unsafe-eval'`이 추가됩니다.

한도 값은 코드의 상수입니다(`room-registry.ts`, `image.service.ts`, `rate-limit.ts`). 한도는 프로세스 메모리에 있어서 재시작하면 초기화됩니다.

## 8. 배포와 재시작 때 일어나는 일

서버는 룸을 메모리에 들고 있고, 바뀐 룸을 약 0.5초 뒤(세션 시작·정지 같은 큰 변화는 즉시) 저장소에 씁니다.

**정상 종료(배포, 재시작, `SIGTERM`)**
1. 새 연결을 받지 않고, `/ready`가 503이 됩니다.
2. 접속 중인 모든 웹소켓을 코드 **1012("서버 재시작")**로 닫습니다. 브라우저 화면은 이 코드를 받으면 "다시 연결 중" 표시와 함께 자동으로 다시 붙습니다(지수 백오프).
3. 변경된 모든 룸을 저장합니다. 한 룸의 저장이 실패해도 나머지는 저장하고, 실패는 로그(`종료 저장 실패`)에 남습니다.
4. DB 연결을 닫고 종료 코드 0으로 끝납니다. 이 과정이 `SHUTDOWN_TIMEOUT_MS`(기본 8초)를 넘기면 강제 종료합니다.

**접속자가 겪는 일**: 새 서버가 뜰 때까지 수 초~수십 초 동안 연결이 끊긴 상태가 됩니다. 진행 중이던 룸 상태는 그대로 이어집니다. 다시 붙으면 놓친 이벤트가 있으면 이어서 받고, 서버가 바뀌어 기억이 없으면 현재 상태 전체(snapshot)를 받습니다. GM이 다시 붙기 전까지 `KP_AWAY_GRACE_MS`(30초)가 지나면 세션이 자동 정지될 수 있으니, 배포는 진행 중인 세션이 없는 시간에 하세요.

**비정상 종료(OOM, 호스트 장애, 강제 종료)**: 마지막 저장 이후 약 0.5초 안의 변경은 잃을 수 있습니다. 잡히지 않은 예외(`uncaughtException`)는 기록하고 저장을 시도한 뒤 종료 코드 1로 내려가며, 호스트가 다시 띄웁니다. 처리되지 않은 Promise 거절은 기록만 하고 계속 돕니다. 한 룸에서 명령 처리 중 예외가 나도 그 요청을 보낸 사람에게 오류만 돌려주고 룸과 다른 룸은 계속 살아 있습니다.

**DB가 잠깐 안 될 때**: 서버와 접속은 유지되고(룸은 메모리에 있습니다) 저장만 재시도됩니다. `/health`가 `degraded`, `saves.consecutiveFailures`가 0보다 크면 저장이 밀리고 있는 것입니다. 이 상태에서 서버가 죽으면 그동안의 변경을 잃으므로 빨리 복구하세요.

## 9. 스키마와 저장 데이터 버전

- **DB 테이블**: 서버가 시작할 때 `create table if not exists` / `add column if not exists`로 맞춥니다([`deploy/schema.sql`](../deploy/schema.sql) = 코드의 `SCHEMA`와 같은 내용. 시험이 두 파일이 같은지 확인합니다). 별도의 마이그레이션 이력 테이블은 없습니다. 지금까지의 변경은 모두 "없으면 추가"로 처리 가능한 것이었습니다. 컬럼을 지우거나 타입을 바꾸는 변경이 필요해지면 그때 번호가 붙은 마이그레이션 도구를 도입해야 합니다.
- **룸 JSON(`rooms.data`)**: `schemaVersion`이 들어 있습니다(지금 2). 불러올 때 `migrateRoomData`가 옛 모양을 지금 모양으로 채웁니다(없는 필드는 기본값, 모양이 깨진 대화·기록 한 줄은 버림). 새 필드는 늘 "없으면 기본값"으로 읽습니다. 번호가 없는 옛 데이터(1)와 더 새로운 번호의 데이터도 열립니다.
- **새 필드를 추가하는 배포**: 하위 호환이라 그냥 배포하면 됩니다. 필드의 의미를 바꾸거나 지우는 변경이면 `ROOM_SCHEMA_VERSION`을 올리고 `migrateRoomData`에 변환을 추가하세요.
- **롤백 주의**: 새 버전이 룸을 저장한 뒤 옛 버전으로 되돌리면, 옛 버전은 모르는 필드를 읽지 않고 **다음 저장 때 지워 버립니다**. 즉 롤백은 데이터를 조용히 깎을 수 있습니다. 스키마 번호가 오른 배포를 되돌릴 때는 롤백 전에 DB 백업(아래)을 받아 두세요.

## 10. 출시 전 점검표

- [ ] Supabase: Discord provider 켬, 콜백 주소를 Discord 앱에 등록, Site URL과 Redirect URLs에 `/auth/callback` 등록
- [ ] Supabase: 토큰 서명 방식 확인(비대칭이면 `SUPABASE_URL`, 레거시면 `SUPABASE_JWT_SECRET`)
- [ ] Supabase: 네 테이블의 RLS가 켜져 있음(Table Editor). `service_role` 키를 어디에도 넣지 않음
- [ ] API: `NODE_ENV=production`, `WEB_ORIGIN`, `TRUST_PROXY`, `DATABASE_URL`, (R2면) `S3_*` 설정
- [ ] API 시작 로그의 `auth`가 `supabase(...)`, `rooms`가 `postgres`, `images`가 `s3(...)`이고 `warn`이 없음
- [ ] `https://<API>/ready`가 200, `https://<API>/health`의 `db.status`가 `ok`
- [ ] 인스턴스가 1개이고 슬립/오토스케일/블루그린이 꺼져 있음, 호스트 종료 대기 10초 이상
- [ ] Vercel: Root Directory `apps/web`, 환경변수 3개, 빌드 성공(`NEXT_PUBLIC_API_URL` 누락 시 실패하도록 되어 있음)
- [ ] 브라우저에서: 디스코드 로그인 → 룸 만들기 → 이미지 올리기 → 다른 계정으로 초대 링크 입장 → 새로고침 → 서버 재시작 후 자동 재접속
- [ ] 개발자 도구 Network에서 웹소켓이 `wss://`로 붙음, 콘솔에 CORS 오류 없음
- [ ] 개발용 로그인이 막혔는지: `curl -i 'https://<API>/rooms?user=x'`가 401
- [ ] 이미지 정리: `--dry-run`으로 한 번 돌려 목록이 상식적인지 확인, 스케줄 등록
- [ ] DB 백업: Supabase 플랜의 자동 백업 여부 확인(무료 플랜은 자동 백업이 없습니다). 최소한 `pg_dump`를 주기적으로 받는 방법을 정해 둠
- [ ] 로그를 볼 곳(호스트 로그 화면)과 `/health` 모니터링(UptimeRobot 등으로 `status`가 `ok`인지)을 정함
- [ ] 디스코드 웹훅이 DB에 평문으로 저장된다는 점을 이해하고 DB 접근 권한을 최소화

## 11. 롤백

| 상황 | 방법 |
| --- | --- |
| 웹 배포가 잘못됨 | Vercel **Deployments**에서 이전 배포의 **Promote to Production**(즉시, 재빌드 없음). 환경변수만 잘못이면 값을 고치고 Redeploy |
| API 배포가 잘못됨 | 이전 이미지/릴리스로 되돌려 다시 배포(Fly: `fly releases`, `fly deploy --image <이전 이미지>`. Render/Railway: 이전 배포 선택). 롤백도 위 8장과 같은 재시작이라 접속이 잠깐 끊깁니다 |
| 스키마 번호가 오른 배포 후 롤백 | 9장 롤백 주의. **롤백 전에 백업**을 받으세요. 옛 코드가 다음 저장에서 새 필드를 지웁니다 |
| 새 환경변수가 문제 | 값을 고치고 재시작. `NODE_ENV=production`에서 설정이 잘못되면 서버가 시작을 거부하고 호스트는 이전 버전을 유지하는 경우가 많습니다(헬스 체크 실패) |
| 이미지 정리가 잘못 지움 | R2/S3에 버킷 버전 관리를 켜 두면 복구할 수 있습니다. 켜 두지 않았다면 복구할 수 없으니 처음에는 `--dry-run`과 `--max-delete`를 쓰세요 |
| DB 데이터가 깨짐 | Supabase 백업(플랜에 따라 Point-in-time 복구) 또는 직접 받은 `pg_dump`에서 복원. 서버를 먼저 내리고 복원한 뒤 올리세요(실행 중인 서버가 메모리의 룸으로 덮어씁니다) |

## 12. 로컬에서 운영 모드로 돌려 보기

```bash
pnpm build:api
NODE_ENV=production PORT=8787 DATA_DIR=/tmp/vtt-data \
  SUPABASE_JWT_SECRET=$(openssl rand -hex 32) WEB_ORIGIN=http://localhost:3000 \
  pnpm start:api                      # node apps/api/dist/main.js

NEXT_PUBLIC_API_URL=http://localhost:8787 pnpm build:web
pnpm --filter @coc-vtt/web start     # next start -p 3000

node scripts/smoke-prod.mjs          # 빌드된 API로 위 흐름을 자동 점검 (WEB_URL=… 을 주면 웹 헤더·404도 확인)
```
