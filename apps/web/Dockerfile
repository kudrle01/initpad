# Platform web UI. Build context = repository root (npm workspaces monorepo):
#   docker build -f apps/web/Dockerfile .
# ---------------------------------------------------------------- build ----
FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @initpad/web --include-workspace-root=false
COPY apps/web apps/web
RUN npm run build --workspace @initpad/web

# -------------------------------------------------------------- runtime ----
FROM nginx:alpine@sha256:df221db836e1754089190208cee7eeda94f233197056426eda74a43ab1abeac2
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
