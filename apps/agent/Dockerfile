ARG BUILDKIT_SBOM_SCAN_STAGE=true

FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/agent/package.json apps/agent/
RUN npm ci --workspace @initpad/agent --include-workspace-root=false
COPY apps/agent apps/agent
RUN npm run build --workspace @initpad/agent

FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80 AS production-dependencies
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/agent/package.json apps/agent/
RUN npm ci --omit=dev --workspace @initpad/agent --include-workspace-root=false

FROM node:26-alpine@sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80
LABEL org.opencontainers.image.title="InitPad Agent"
LABEL org.opencontainers.image.description="Outbound-only agent for an InitPad Docker target"
LABEL org.opencontainers.image.version="0.14.3"
WORKDIR /app
COPY --from=build /repo/apps/agent/dist ./dist
COPY --from=production-dependencies /repo/node_modules ./node_modules
COPY apps/agent/package.json ./package.json
ENV INITPAD_AGENT_CONFIG=/var/lib/initpad-agent/agent.json
VOLUME ["/var/lib/initpad-agent"]
ENTRYPOINT ["node", "/app/dist/cli.js"]
CMD ["run"]
