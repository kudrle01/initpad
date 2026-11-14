FROM mirror.gcr.io/library/node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/supervisor/package.json apps/supervisor/
# The build stage includes the workspace root: TypeScript is declared once there.
RUN npm ci --workspace @initpad/supervisor --include-workspace-root
COPY apps/supervisor apps/supervisor
# Tests compile next to the code they cover; the image ships only the runtime.
RUN npm run build --workspace @initpad/supervisor \
    && find apps/supervisor/dist -name '*.test.js*' -delete

FROM mirror.gcr.io/library/node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS production-dependencies
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/supervisor/package.json apps/supervisor/
RUN npm ci --omit=dev --workspace @initpad/supervisor --include-workspace-root=false

FROM mirror.gcr.io/library/docker:29.9.3-cli@sha256:5a7af0dcb0e46c803efe9b45371dd21cb500e5b4453250394ac6f06d49b6e6f1 AS docker-cli

FROM mirror.gcr.io/library/node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5
LABEL org.opencontainers.image.title="InitPad Supervisor"
LABEL org.opencontainers.image.description="Typed, signed and health-gated self-hosted updates"
LABEL org.opencontainers.image.version="0.2.37"
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
