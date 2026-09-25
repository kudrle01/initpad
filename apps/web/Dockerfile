# Platform web UI. Build context = repository root (npm workspaces monorepo):
#   docker build -f apps/web/Dockerfile .
# ---------------------------------------------------------------- build ----
FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @initpad/web --include-workspace-root=false
COPY apps/web apps/web
RUN npm run build --workspace @initpad/web

# -------------------------------------------------------------- runtime ----
FROM nginx:alpine@sha256:72ba65eb42c10344912a84ff42408db7d34f2feb642204570ab8fc5ffd29f1d3
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
