# syntax=docker/dockerfile:1
#
# API 서버(apps/api) 이미지. 저장소 루트에서 빌드합니다:
#   docker build -t coc-vtt-api .
#   docker run --rm -p 8080:8080 --env-file apps/api/.env coc-vtt-api
#
# 웹(apps/web)은 Vercel에 올리므로 이 이미지에 들어 있지 않습니다.
# 주의: 룸이 서버 메모리에 있으므로 컨테이너는 한 개만 띄웁니다(docs/deploy-env.md).

# ── 1단계: 빌드 ─────────────────────────────────────────
FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# 의존성 설치는 manifest만 먼저 복사해서 캐시가 잘 먹게 한다.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/room-core/package.json packages/room-core/
RUN pnpm install --frozen-lockfile --filter @coc-vtt/api...

COPY tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
# TS 소스(shared, room-core 포함)를 dist/main.js 하나로 묶는다.
RUN pnpm --filter @coc-vtt/api build \
 && pnpm --filter @coc-vtt/api deploy --prod --legacy /out

# ── 2단계: 실행 ─────────────────────────────────────────
FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
# 운영 의존성(pnpm deploy 결과)과 빌드 결과물만 가져온다. 소스·개발 도구는 들어가지 않는다.
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
COPY --from=build --chown=node:node /out/package.json ./package.json
USER node
EXPOSE 8080
# 프로세스가 응답하는지만 본다(DB가 잠깐 안 돼도 컨테이너를 죽이지 않는다). 손님을 받아도 되는지는 /ready.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# node가 PID 1이어도 SIGTERM을 직접 처리한다(연결을 1012로 닫고 룸을 저장한 뒤 종료).
CMD ["node", "dist/main.js"]
