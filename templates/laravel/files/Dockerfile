FROM php:8.3-cli-alpine@sha256:e7699f91d3b46283a49bde02379266dd98d87844e08aed1ff7ea6a7d1f031268 AS base
RUN apk add --no-cache oniguruma-dev \
 && docker-php-ext-install mbstring
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
FROM dunglas/frankenphp:1.13.5-php8.3-alpine@sha256:8a84f4e33f207cc63a1b829a828bfdc1f0d665d503597d038e56118ffa4e364f AS runtime
ENV APP_ENV=production \
    APP_DEBUG=false \
    CACHE_STORE=file \
    QUEUE_CONNECTION=sync \
    SESSION_DRIVER=file \
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
 && mkdir -p storage/framework/cache storage/framework/sessions storage/framework/views bootstrap/cache \
 && chown -R www-data:www-data /app /data/caddy /config/caddy
USER www-data
EXPOSE 8080
# The base image probes the Caddy admin API, which is switched off here.
HEALTHCHECK CMD curl -fsS http://127.0.0.1:8080/health >/dev/null || exit 1
CMD ["sh", "/app/docker-entrypoint.sh"]
