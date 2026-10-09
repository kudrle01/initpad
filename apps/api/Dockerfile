# Platform API. Build context = repository root (npm workspaces monorepo):
#   docker build -f apps/api/Dockerfile .
# ---------------------------------------------------------------- build ----
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
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

# ------------------------------------------------ production dependencies ----
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS production-dependencies
RUN apk add --no-cache openssl
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/api/prisma apps/api/prisma
RUN npm ci --omit=dev --workspace @initpad/api --include-workspace-root=false

# -------------------------------------------------------------- runtime ----
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
# Installed packages take the fixes Alpine published after the base image
# (ADR-144). npm, npx, corepack and yarn are build tools with dependencies of
# their own; the runtime never calls them, so the image does not ship them.
# git: scaffold init/push at project creation (deployments themselves are
# stateless and fetch archives from Gitea over HTTP).
# openssl: required by the Prisma engines (see the build stage note).
RUN apk upgrade --no-cache \
    && apk add --no-cache git openssl \
    && rm -rf /usr/local/lib/node_modules /opt/yarn-* \
        /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
        /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production
COPY --from=production-dependencies /repo /repo
WORKDIR /repo
COPY apps/api/scripts apps/api/scripts
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY apps/agent/install.sh apps/agent/install.sh
COPY apps/agent/package.json apps/agent/package.json
COPY templates /templates
WORKDIR /repo/apps/api
EXPOSE 3000
# Load deployment secrets before Prisma reads DATABASE_URL, then apply
# versioned migrations before accepting traffic. Unlike `db push`, this
# preserves migration history and never guesses destructive schema changes.
CMD ["node", "scripts/run-with-secrets.js", "sh", "-c", "node scripts/migrate.js && exec node dist/main.js"]
