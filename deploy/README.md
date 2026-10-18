# deploy/

배포 예시 파일 모음입니다. 비밀 값은 어디에도 넣지 않았습니다. 단계별 설명은 [docs/deploy-env.md](../docs/deploy-env.md)를 보세요.

| 파일 | 용도 |
| --- | --- |
| `../Dockerfile` | API 서버 이미지(저장소 루트에서 빌드). 웹은 Vercel에 올립니다 |
| `fly.toml` | Fly.io 설정 예시 |
| `render.yaml` | Render Blueprint 예시(웹 서비스 + 이미지 정리 cron) |
| `railway.json` | Railway 설정 예시. 환경변수는 대시보드에서 넣습니다(아래) |
| `schema.sql` | Postgres 스키마(서버가 시작할 때 자동으로 만드는 것과 같습니다) |

## 어느 호스트든 지켜야 하는 것

- **한 개만** 띄웁니다. 룸이 서버 메모리에 있어서 두 개가 동시에 떠 있으면 같은 룸이 둘로 갈라지고 서로의 저장을 덮어씁니다. 새 버전을 옛 버전 옆에 먼저 띄우는 배포(blue/green, canary, 무중단 롤링)는 쓰지 마세요.
- 재우지 않습니다. 요청이 없으면 잠드는 무료 플랜은 맞지 않습니다.
- 헬스 체크는 `/ready`(손님 받을 준비), 살아 있는지만 보려면 `/health`입니다.
- 종료 신호(SIGTERM)를 받으면 접속자에게 1012(서버 재시작)를 알리고 룸을 저장한 뒤 끝냅니다. 호스트의 종료 대기 시간은 10초 이상으로 두세요.
- `PORT`는 호스트가 정해 주는 값을 따릅니다(Dockerfile 기본 8080).

## Railway 환경변수

`railway.json`은 JSON이라 주석을 못 달아 여기에 적습니다. Variables 탭에 넣을 값은 `NODE_ENV=production`, `TRUST_PROXY=1`, `WEB_ORIGIN`, `SUPABASE_URL`, `DATABASE_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`입니다. `PORT`는 Railway가 넣어 줍니다. Replicas는 1로 둡니다. 이미지 정리는 같은 저장소로 만든 Cron 서비스에서 `node dist/cleanup-images.js --days 7 --max-delete 500`을 주 1회 돌리면 됩니다.

## 이미지 정리를 직접 돌릴 때

```bash
# 컨테이너 안(또는 같은 환경변수를 준 로컬)에서
node dist/cleanup-images.js --dry-run      # 지울 목록만 본다
node dist/cleanup-images.js --days 7       # 지운다
# 저장소에서는: pnpm build:api && pnpm cleanup:images --dry-run
```
