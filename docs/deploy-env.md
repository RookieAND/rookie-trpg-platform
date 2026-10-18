# 배포 환경변수

API(`apps/api`)와 웹(`apps/web`)이 읽는 환경변수 전체입니다. API 예시는 `apps/api/.env.example`에 있습니다.

## API (`apps/api`)

| 이름 | 필수 | 기본값 | production에서 빠지면 |
| --- | --- | --- | --- |
| `NODE_ENV` | 권장 | 없음(개발로 취급) | 개발 모드로 떠서 아래 안전장치가 꺼집니다. 운영에서는 `production`으로 두세요 |
| `SUPABASE_JWT_SECRET` | production 필수 | 없음 | **부팅을 거부합니다.** (`ALLOW_DEV_AUTH=1`이면 개발용 인증으로 뜹니다. 아래 참고) |
| `ALLOW_DEV_AUTH` | 아니오 | 꺼짐 | 켜면 production에서도 개발용 인증(쿼리 `user`, 헤더 `x-dev-user`)을 씁니다. `SUPABASE_JWT_SECRET`이 있으면 무시됩니다 |
| `DATABASE_URL` | 권장 | 없음 | 파일 저장(`DATA_DIR`)으로 뜨고 시작 로그에 경고가 나옵니다 |
| `DATA_DIR` | 아니오 | `./data` | `DATABASE_URL`도 없으면 실행 위치 기준 `./data`에 저장합니다. 실행 위치가 바뀌면 빈 저장소로 뜨니 절대 경로를 쓰세요. `memory`는 재시작 때 모두 사라집니다 |
| `WEB_ORIGIN` | production 필수 | `http://localhost:3000` | CORS가 localhost만 허용해 실제 웹에서 API 호출이 막힙니다. 시작 로그에 경고가 나옵니다 |
| `PORT` | 아니오 | `8787` | 기본 포트로 뜹니다. 정수 1~65535가 아니면 부팅을 거부합니다 |
| `TRUST_PROXY` | 프록시 뒤라면 | `0`(안 믿음) | `X-Forwarded-For`를 무시하고 소켓 주소로 IP 한도를 셉니다. 프록시 뒤에서 빠지면 모든 사용자가 프록시 IP 하나로 묶입니다 |
| `APP_VERSION` | 아니오 | `package.json` 버전 | `/health`의 `version`이 패키지 버전으로 나옵니다 |

### 인증 모드

시작 로그의 `auth:` 항목으로 확인합니다.

- `auth: supabase` — Supabase 토큰(`Authorization: Bearer`, ws는 `token` 쿼리)만 받습니다.
- `auth: dev (개발용)` — 이름만 적으면 그 사람이 됩니다. 로그에 `[경고]`가 붙습니다. 로컬 개발에서만 쓰세요.

production에서 `SUPABASE_JWT_SECRET` 없이 `ALLOW_DEV_AUTH`도 없으면 서버는 다음 오류를 내고 종료 코드 1로 끝납니다.

```
설정 오류: NODE_ENV=production인데 SUPABASE_JWT_SECRET이 없어요. ...
```

### 프록시 뒤에서 (`TRUST_PROXY`)

IP 단위 업로드 한도는 요청한 쪽 IP로 셉니다. 로드밸런서나 리버스 프록시 뒤라면 `TRUST_PROXY=1`(프록시 1겹)로 두세요. `X-Forwarded-For`의 **오른쪽에서 N번째** 값을 쓰므로, 클라이언트가 왼쪽에 적은 가짜 값으로는 우회할 수 없습니다. 프록시 없이 직접 노출하는 서버에서는 켜지 마세요(켜면 헤더를 위조해 한도를 피할 수 있습니다).

## 웹 (`apps/web`)

`NEXT_PUBLIC_*`는 **빌드할 때** 번들에 박힙니다. 배포 환경에서 바꾸려면 다시 빌드해야 합니다.

| 이름 | 필수 | 기본값 | 빠지면 |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | production 필수 | `http://localhost:8787` | 방문자의 localhost로 API를 부릅니다 |
| `NEXT_PUBLIC_REALTIME_URL` | production 필수 | `ws://localhost:8787/ws` | 방문자의 localhost로 웹소켓을 붙으려 합니다 |
| `NEXT_PUBLIC_SUPABASE_URL` | production 필수 | 없음 | 디스코드 로그인이 꺼지고 개발용 이름 로그인 화면이 나옵니다(API가 production이면 서버가 거절합니다) |
| `WEB_URL`, `CHROMIUM_PATH`, `SHOT`, `SHOT_KP` | 아니오 | e2e 전용 | 배포와 무관합니다 |

웹 쪽은 기동 시점 검증이 없습니다. 위 세 값은 배포 전에 직접 확인하세요.

## 비밀 값 취급

- **`SUPABASE_JWT_SECRET`**, **`DATABASE_URL`**(비밀번호 포함)은 시크릿 저장소/호스팅 환경변수로만 주입하고 저장소에 올리지 않습니다. 로그와 `/health`에는 나오지 않습니다.
- **디스코드 웹훅 URL은 평문으로 저장됩니다.** 룸 설정(`meta.discord.webhookUrl`)에 들어 있어 파일 저장이면 `DATA_DIR/<룸id>.json`, Postgres면 `rooms.meta`(jsonb)에 그대로 있습니다. 백업과 DB 덤프에도 포함되므로 같은 수준으로 보호하세요. 룸 주인 말고는 API가 돌려주지 않고(주인에게도 "연결됨" 여부만), 전송 실패 로그와 오류 응답에는 주소를 가려서([웹훅 주소]) 남깁니다. 유출이 의심되면 디스코드에서 웹훅을 삭제하고 새로 만드세요. 암호화 저장은 아직 없습니다.

## 서버가 걸어 두는 한도

| 항목 | 값 |
| --- | --- |
| 웹소켓 메시지 | 연결당 버스트 120건, 초당 60건 보충. 넘기면 `rate_limited` 오류, 10초 안에 100번 넘게 거절되면 연결 종료(1008) |
| 웹소켓 하트비트 | 30초마다 ping, 직전 ping에 응답이 없으면 연결 종료 |
| 룸 | 계정당 20개까지, 시간당 10개까지 생성 |
| 이미지·오디오 업로드 | 계정당 종류별 시간당 30개, IP당 시간당 60개(이미지·오디오 합산) |
| 룸 삭제 | 룸 데이터가 참조하던 이미지·오디오 파일도 함께 삭제 |

한도 값은 코드의 상수입니다(`room-registry.ts`, `image.service.ts`, `rate-limit.ts`). 한도는 프로세스 메모리에 있어서 재시작하면 초기화되고, 서버를 여러 대 띄우면 서버마다 따로 셉니다.

## 프로세스 종료

`SIGTERM`/`SIGINT`를 받으면 연결을 닫고 모든 룸의 마지막 상태를 저장한 뒤 종료합니다. 잡히지 않은 예외는 로그(`[uncaughtException]`)를 남기고 같은 저장 절차 후 종료 코드 1로 내려갑니다(프로세스 관리자가 다시 띄워야 합니다). 처리 안 된 Promise 거절은 `[unhandledRejection]`으로 기록만 하고 계속 돕니다.
