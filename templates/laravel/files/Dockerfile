FROM php:8.5-cli-alpine@sha256:aa66ee4275e0472bafcd18e35142499fcbda6ac90e641e751418e052e6a0d812 AS base
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
RUN composer install --no-dev --no-interaction --prefer-dist --no-progress --classmap-authoritative

FROM base AS runtime
ENV APP_ENV=production \
    APP_DEBUG=false \
    CACHE_STORE=file \
    QUEUE_CONNECTION=sync \
    SESSION_DRIVER=file
COPY . .
COPY --from=production-deps /app/vendor ./vendor
RUN mkdir -p storage/framework/cache storage/framework/sessions storage/framework/views bootstrap/cache \
 && chown -R www-data:www-data /app
USER www-data
EXPOSE 8080
CMD ["sh", "/app/docker-entrypoint.sh"]
