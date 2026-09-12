# Simulated company VPS for deploying runtime applications over SSH.
# openssh-server (Alpine, s6) + the Node.js runtime + deployment tooling.
FROM lscr.io/linuxserver/openssh-server:latest@sha256:39ba37d50fdd6be1bf70644c871e5dcb9234ee79ac56424ea03ca08cadf1e7b0

# node/npm (application runtime), curl (in-container health checks),
# tar (extracting the uploaded source archive).
RUN apk add --no-cache nodejs npm curl tar

# User/password and port configuration is provided via environment variables
# in docker-compose (USER_NAME, USER_PASSWORD, PASSWORD_ACCESS).
# sshd listens on 2222.
