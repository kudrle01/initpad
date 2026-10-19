# Platform web UI. Build context = repository root (npm workspaces monorepo):
#   docker build -f apps/web/Dockerfile .
# ---------------------------------------------------------------- build ----
FROM mirror.gcr.io/library/node:26-alpine@sha256:6f08a523443ddedf52941874c203475b0ad503e859ad70cb26ab8be9a517dbd5 AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @initpad/web --include-workspace-root=false
COPY apps/web apps/web
RUN npm run build --workspace @initpad/web

# -------------------------------------------------------------- runtime ----
FROM mirror.gcr.io/library/nginx:alpine@sha256:892bb2152464f0c5d8972593a5f5afaf8054552580b699d95f8ff4af08c2d33d
# Installed packages take the fixes Alpine published after the base image.
RUN apk upgrade --no-cache
COPY apps/web/nginx-main.conf /etc/nginx/nginx.conf
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
# No root and no capability (ADR-144): Docker lets an unprivileged process bind
# port 80 inside the container's network namespace, and nginx writes only /tmp.
USER nginx
EXPOSE 80
