FROM php:8.5-cli-alpine@sha256:e899a75c775804e5466dbd9c96b31f8b6c6ae2ddb053a8466223a0c32992ff8e AS base
COPY --from=composer:2@sha256:d8f6343d3fae98107426bc49163ccad46ef85aabd4a27d80a74401fab4aba332 /usr/bin/composer /usr/bin/composer
WORKDIR /app

FROM base AS test
COPY composer.json composer.lock ./
RUN composer install --no-interaction --prefer-dist --no-progress
COPY . .
RUN vendor/bin/phpunit

FROM base AS production-deps
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-interaction --prefer-dist --no-progress --optimize-autoloader

# FrankenPHP is a production web server; `php -S` is a development tool.
FROM dunglas/frankenphp:1.13.4-php8.3-alpine@sha256:df92e348a4239f51ca5519af0fb578c1eea0ccd427eaf2704d7b44cf9f680d4c AS runtime
ENV APP_ENV=prod \
    APP_DEBUG=0 \
    SERVER_NAME=:8080 \
    SERVER_ROOT=/app/public \
    CADDY_GLOBAL_OPTIONS="admin off"
WORKDIR /app
COPY . .
COPY --from=production-deps /app/vendor ./vendor
# Port 8080 needs no capability. Without the file capability the server also
# starts when the platform drops every capability under no-new-privileges.
RUN setcap -r /usr/local/bin/frankenphp \
 && printf 'expose_php = Off\ndisplay_errors = Off\nlog_errors = On\nvariables_order = "EGPCS"\n' \
      > "$PHP_INI_DIR/conf.d/zz-production.ini" \
 && mkdir -p var/cache var/log \
 && chown -R www-data:www-data /app /data/caddy /config/caddy
USER www-data
EXPOSE 8080
# The base image probes the Caddy admin API, which is switched off here.
HEALTHCHECK CMD curl -fsS http://127.0.0.1:8080/health >/dev/null || exit 1
CMD ["sh", "/app/docker-entrypoint.sh"]
