FROM php:8.3-cli-alpine@sha256:86a7a8f46bbf73120a19cf72246f606b6de9aaa84a00971c25d187fbae44c211 AS base
COPY --from=composer:2@sha256:d8f6343d3fae98107426bc49163ccad46ef85aabd4a27d80a74401fab4aba332 /usr/bin/composer /usr/bin/composer
WORKDIR /app

FROM base AS test
COPY composer.json composer.lock ./
RUN composer install --no-interaction --prefer-dist --no-progress
COPY . .
RUN vendor/bin/phpunit

FROM base AS production-deps
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-interaction --prefer-dist --no-progress
COPY app ./app
RUN composer dump-autoload --no-dev --classmap-authoritative --no-interaction

# FrankenPHP is a production web server; `php -S` is a development tool.
FROM dunglas/frankenphp:1.13.4-php8.3-alpine@sha256:df92e348a4239f51ca5519af0fb578c1eea0ccd427eaf2704d7b44cf9f680d4c AS runtime
ENV SERVER_NAME=:8080 \
    SERVER_ROOT=/app/www \
    CADDY_GLOBAL_OPTIONS="admin off"
WORKDIR /app
COPY . .
COPY --from=production-deps /app/vendor ./vendor
RUN php -r "require 'vendor/autoload.php'; exit(class_exists('App\\Bootstrap') ? 0 : 1);"
# Port 8080 needs no capability. Without the file capability the server also
# starts when the platform drops every capability under no-new-privileges.
RUN setcap -r /usr/local/bin/frankenphp \
 && printf 'expose_php = Off\ndisplay_errors = Off\nlog_errors = On\nvariables_order = "EGPCS"\n' \
      > "$PHP_INI_DIR/conf.d/zz-production.ini" \
 && mkdir -p temp log \
 && chown -R www-data:www-data /app /data/caddy /config/caddy
USER www-data
EXPOSE 8080
# The base image probes the Caddy admin API, which is switched off here.
HEALTHCHECK CMD curl -fsS http://127.0.0.1:8080/health >/dev/null || exit 1
