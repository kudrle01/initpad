# Platform API. Build context = repository root (npm workspaces monorepo):
#   docker build -f apps/api/Dockerfile .
# ---------------------------------------------------------------- build ----
FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS build
# openssl: Prisma detects the SSL version at install time and downloads the
# matching engine binaries — without it the detection silently falls back to
# openssl 1.1 and the engines fail to load at runtime.
RUN apk add --no-cache openssl
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/api/prisma apps/api/prisma
RUN npm ci --workspace @initpad/api --include-workspace-root=false
COPY apps/api apps/api
RUN npm run build --workspace @initpad/api

# -------------------------------------------------------------- runtime ----
FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4
# git: scaffold init/push at project creation (deployments themselves are
# stateless and fetch archives from Gitea over HTTP).
# openssl: required by the Prisma engines (see the build stage note).
RUN apk add --no-cache git openssl
WORKDIR /repo
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/api/prisma apps/api/prisma
COPY apps/api/scripts apps/api/scripts
RUN npm ci --omit=dev --workspace @initpad/api --include-workspace-root=false \
    && npm cache clean --force
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY apps/agent/install.sh apps/agent/install.sh
COPY apps/agent/package.json apps/agent/package.json
COPY templates /templates
WORKDIR /repo/apps/api
EXPOSE 3000
# Apply versioned, reviewable migrations before accepting traffic. Unlike
# `db push`, this preserves migration history and never guesses destructive
# schema changes in production.
CMD ["sh", "-c", "node scripts/migrate.js && exec node dist/main.js"]
