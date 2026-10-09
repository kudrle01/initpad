FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/supervisor/package.json apps/supervisor/
RUN npm ci --workspace @initpad/supervisor --include-workspace-root=false
COPY apps/supervisor apps/supervisor
# Tests compile next to the code they cover; the image ships only the runtime.
RUN npm run build --workspace @initpad/supervisor \
    && find apps/supervisor/dist -name '*.test.js*' -delete

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS production-dependencies
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/supervisor/package.json apps/supervisor/
RUN npm ci --omit=dev --workspace @initpad/supervisor --include-workspace-root=false

FROM docker:29.8.0-cli@sha256:eccaacfeed644c7de222ff047483568cb988dde95476fbaaf10ea2d04921bb66 AS docker-cli

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
LABEL org.opencontainers.image.title="InitPad Supervisor"
LABEL org.opencontainers.image.description="Typed, signed and health-gated self-hosted updates"
LABEL org.opencontainers.image.version="0.2.16"
# Installed packages take the fixes Alpine published after the base image
# (ADR-144). npm, npx, corepack and yarn are build tools with dependencies of
# their own; the runtime never calls them, so the image does not ship them.
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules /opt/yarn-* \
        /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
        /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
COPY --from=production-dependencies /repo /app
COPY --from=build /repo/apps/supervisor/dist /app/apps/supervisor/dist
WORKDIR /app/apps/supervisor
USER root
EXPOSE 7070
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["serve"]
