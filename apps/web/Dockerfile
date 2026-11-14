# Platform web UI. Build context = repository root (npm workspaces monorepo):
#   docker build -f apps/web/Dockerfile .
# ---------------------------------------------------------------- build ----
FROM mirror.gcr.io/library/node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
# The build stage includes the workspace root: TypeScript is declared once there.
RUN npm ci --workspace @initpad/web --include-workspace-root
COPY apps/web apps/web
RUN npm run build --workspace @initpad/web

# -------------------------------------------------------------- runtime ----
FROM mirror.gcr.io/library/nginx:alpine@sha256:fed7e14be83cbd2661a75cdc5b872d936cf155d46c327084d30b8df19ae88d72
# Installed packages take the fixes Alpine published after the base image.
RUN apk upgrade --no-cache
COPY apps/web/nginx-main.conf /etc/nginx/nginx.conf
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
# No root and no capability (ADR-144): Docker lets an unprivileged process bind
# port 80 inside the container's network namespace, and nginx writes only /tmp.
USER nginx
EXPOSE 80
