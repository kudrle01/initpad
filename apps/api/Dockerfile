# Platform API. Build context = repository root (npm workspaces monorepo):
#   docker build -f apps/api/Dockerfile .
# ---------------------------------------------------------------- build ----
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/api/prisma apps/api/prisma
RUN npm ci --workspace @initpad/api --include-workspace-root=false
COPY apps/api apps/api
RUN npm run build --workspace @initpad/api

# -------------------------------------------------------------- runtime ----
FROM node:22-alpine
# git: scaffold init/push at project creation (deployments themselves are
# stateless and fetch archives from Gitea over HTTP).
RUN apk add --no-cache git
WORKDIR /repo
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/api/prisma apps/api/prisma
RUN npm ci --omit=dev --workspace @initpad/api --include-workspace-root=false \
    && npm cache clean --force
COPY --from=build /repo/apps/api/dist apps/api/dist
WORKDIR /repo/apps/api
EXPOSE 3000
# `prisma db push` syncs the schema on startup (idempotent) — no manual
# migration step during installation.
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/main.js"]
