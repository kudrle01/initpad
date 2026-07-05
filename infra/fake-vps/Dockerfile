# Simulated company VPS for deploying runtime applications over SSH.
# openssh-server (Alpine, s6) + the Node.js runtime + deployment tooling.
FROM lscr.io/linuxserver/openssh-server:latest

# node/npm (application runtime), curl (in-container health checks),
# tar (extracting the uploaded source archive).
RUN apk add --no-cache nodejs npm curl tar

# User/password and port configuration is provided via environment variables
# in docker-compose (USER_NAME, USER_PASSWORD, PASSWORD_ACCESS).
# sshd listens on 2222.
