FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/supervisor/package.json apps/supervisor/
RUN npm ci --workspace @initpad/supervisor --include-workspace-root=false
COPY apps/supervisor apps/supervisor
RUN npm run build --workspace @initpad/supervisor

FROM docker:27.5.1-cli@sha256:851f91d241214e7c6db86513b270d58776379aacc5eb9c4a87e5b47115e3065c AS docker-cli

FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32
LABEL org.opencontainers.image.title="InitPad Supervisor"
LABEL org.opencontainers.image.description="Typed, signed and health-gated self-hosted updates"
LABEL org.opencontainers.image.version="0.2.3"
WORKDIR /app
COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
COPY package.json package-lock.json ./
COPY apps/supervisor/package.json apps/supervisor/
RUN npm ci --omit=dev --workspace @initpad/supervisor --include-workspace-root=false \
    && npm cache clean --force
COPY --from=build /repo/apps/supervisor/dist apps/supervisor/dist
WORKDIR /app/apps/supervisor
USER root
EXPOSE 7070
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["serve"]
