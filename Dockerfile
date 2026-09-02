# DSS A/S 관리 시스템 — 운영 이미지
#
# 개발 PC에서 굽고 NAS로 옮긴다. 절차는 ../dss-deploy/runbook/02-이미지-빌드.md
#
#   docker build -t dss-as:1.0 .
#   docker save dss-as:1.0 -o dss-as-1.0.tar
#   (NAS에서) docker load -i dss-as-1.0.tar

ARG NODE_IMAGE=node:22-bookworm-slim

# ── 1단계 : 라이브러리만 설치한다 ─────────────────────────────────────
#
# package 파일만 먼저 복사한다. 소스를 먼저 복사하면 화면 한 줄만 고쳐도
# 라이브러리를 처음부터 다시 깐다 — 이 순서 하나가 빌드 시간을 몇 배 가른다.
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ── 2단계 : 앱을 굽는다 ───────────────────────────────────────────────
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 빌드에만 쓰는 가짜 DATABASE_URL.
#
# `next build`는 각 화면의 데이터를 모으려고 서버 모듈을 실제로 불러온다.
# src/lib/db/connection.ts가 모듈을 읽는 순간 DATABASE_URL이 있는지 검사하고
# 없으면 던진다. 개발 PC에서는 .env.local이 있어 지나가지만, 이미지에는
# .dockerignore가 .env*를 막아 두어(그게 맞다) 값이 없다.
#
# 접속은 하지 않는다 — postgres.js는 실제로 쓸 때 연결한다. 값이 "있기만" 하면
# 되므로 누가 봐도 가짜인 값을 쓴다. 이 값은 이 단계에만 있고 최종 이미지에는
# 남지 않는다(3단계는 별도 FROM이다).
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build_time_only"

RUN npm run build

# ── 3단계 : 실행에 필요한 것만 담는다 ─────────────────────────────────
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production

# psql·pg_dump — 배포 리허설과 접속 문제를 들여다볼 때 쓴다.
# ⚠️ Debian bookworm의 기본 저장소에는 15까지만 있다. 서버가 17이므로
#    공식 저장소를 추가해 17을 받는다. 클라이언트가 낮으면 거절당한다.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl; \
    install -d /usr/share/postgresql-common/pgdg; \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc; \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends postgresql-client-17; \
    apt-get purge -y --auto-remove curl; \
    rm -rf /var/lib/apt/lists/*

# standalone은 public과 .next/static을 자동으로 담지 않는다(Next 문서 output.md).
#
# ⚠️ 이 저장소는 public이 특히 중요하다. src/app/layout.tsx가 **런타임에**
#    public/theme-init.js를 읽는다. 빠뜨리면 CSS만 깨지는 게 아니라
#    첫 화면부터 죽는다.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

RUN mkdir -p .next/cache && chown -R node:node /app

USER node

# ⚠️ 첨부파일(사진·도면·성적서)은 이미지에 없다. 저장소 밖 경로에 있고
#    운영에서는 볼륨으로 붙인다. 이미지를 새로 올려도 파일은 그대로 남는다.
#
# 엑셀 업로드 한도가 21MB다(next.config.ts). 큰 워크북을 파싱할 때 메모리가
# 크게 튀므로, compose에서 이 컨테이너에 메모리 상한을 걸어 두는 편이 좋다 —
# 터지더라도 이 컨테이너만 죽고 로그인 포털은 살아남는다.
ENV PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000

CMD ["node", "server.js"]
