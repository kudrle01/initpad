# Simulovaná firemní VPS pro nasazení runtime aplikací přes SSH.
# openssh-server (Alpine, s6) + Node.js runtime + nástroje pro deploy.
FROM lscr.io/linuxserver/openssh-server:latest

# Node/npm (běh aplikace), curl (health uvnitř), tar (rozbalení nahraného zdroje).
RUN apk add --no-cache nodejs npm curl tar

# Konfigurace uživatele/hesla i portů se předává přes environment v compose
# (USER_NAME, USER_PASSWORD, PASSWORD_ACCESS). sshd naslouchá na 2222.
