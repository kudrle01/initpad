ARG BUILDKIT_SBOM_SCAN_STAGE=true

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/agent/package.json apps/agent/
RUN npm ci --workspace @initpad/agent --include-workspace-root=false
COPY apps/agent apps/agent
# Tests compile next to the code they cover; the image ships only the runtime.
RUN npm run build --workspace @initpad/agent \
    && find apps/agent/dist -name '*.test.js*' -delete

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS production-dependencies
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/agent/package.json apps/agent/
RUN npm ci --omit=dev --workspace @initpad/agent --include-workspace-root=false

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
LABEL org.opencontainers.image.title="InitPad Agent"
LABEL org.opencontainers.image.description="Outbound-only agent for an InitPad Docker target"
LABEL org.opencontainers.image.version="0.14.3"
# Installed packages take the fixes Alpine published after the base image
# (ADR-144). npm, npx, corepack and yarn are build tools with dependencies of
# their own; the runtime never calls them, so the image does not ship them.
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules /opt/yarn-* \
        /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
        /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
COPY --from=build /repo/apps/agent/dist ./dist
COPY --from=production-dependencies /repo/node_modules ./node_modules
COPY apps/agent/package.json ./package.json
ENV INITPAD_AGENT_CONFIG=/var/lib/initpad-agent/agent.json
VOLUME ["/var/lib/initpad-agent"]
ENTRYPOINT ["node", "/app/dist/cli.js"]
CMD ["run"]
