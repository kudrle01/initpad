ARG BUILDKIT_SBOM_SCAN_STAGE=true

FROM node:26-alpine@sha256:dbaa92e5758cbbcf85d65d5403fdb530fe3442cbe8c6dbfb7ef23365450d5070 AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/agent/package.json apps/agent/
RUN npm ci --workspace @initpad/agent --include-workspace-root=false
COPY apps/agent apps/agent
RUN npm run build --workspace @initpad/agent

FROM node:26-alpine@sha256:dbaa92e5758cbbcf85d65d5403fdb530fe3442cbe8c6dbfb7ef23365450d5070
LABEL org.opencontainers.image.title="InitPad Agent"
LABEL org.opencontainers.image.description="Outbound-only agent for an InitPad Docker target"
LABEL org.opencontainers.image.version="0.13.0"
WORKDIR /app
COPY --from=build /repo/apps/agent/dist ./dist
COPY apps/agent/package.json ./package.json
ENV INITPAD_AGENT_CONFIG=/var/lib/initpad-agent/agent.json
VOLUME ["/var/lib/initpad-agent"]
ENTRYPOINT ["node", "/app/dist/cli.js"]
CMD ["run"]
