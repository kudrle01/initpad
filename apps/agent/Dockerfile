FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/agent/package.json apps/agent/
RUN npm ci --workspace @initpad/agent --include-workspace-root=false
COPY apps/agent apps/agent
RUN npm run build --workspace @initpad/agent

FROM node:22-alpine
LABEL org.opencontainers.image.title="InitPad Agent"
LABEL org.opencontainers.image.description="Outbound-only agent for an InitPad Docker target"
LABEL org.opencontainers.image.version="0.3.0"
WORKDIR /app
COPY --from=build /repo/apps/agent/dist ./dist
COPY apps/agent/package.json ./package.json
ENV INITPAD_AGENT_CONFIG=/var/lib/initpad-agent/agent.json
VOLUME ["/var/lib/initpad-agent"]
ENTRYPOINT ["node", "/app/dist/cli.js"]
CMD ["run"]
