FROM dunglas/frankenphp:1.13.2-php8.3-alpine@sha256:1f02125b316bae85753b2ab7127a79ecc305f03215c8fe6ab33678e65177095d AS base
WORKDIR /app
COPY . .

FROM base AS test
RUN php -l public/index.php

# FrankenPHP is a production web server; `php -S` is a development tool.
FROM base AS runtime
ENV SERVER_NAME=:8080 \
    SERVER_ROOT=/app/public \
    CADDY_GLOBAL_OPTIONS="admin off"
# Port 8080 needs no capability. Without the file capability the server also
# starts when the platform drops every capability under no-new-privileges.
RUN setcap -r /usr/local/bin/frankenphp \
 && printf 'expose_php = Off\ndisplay_errors = Off\nlog_errors = On\n' \
      > "$PHP_INI_DIR/conf.d/zz-production.ini" \
 && chown -R www-data:www-data /data/caddy /config/caddy
USER www-data
EXPOSE 8080
# The base image probes the Caddy admin API, which is switched off here.
HEALTHCHECK CMD curl -fsS http://127.0.0.1:8080/health >/dev/null || exit 1
