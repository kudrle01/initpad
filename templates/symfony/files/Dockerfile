FROM php:8.3-cli-alpine AS base
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
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
ENV APP_ENV=prod APP_DEBUG=0 APP_SECRET=change-me
COPY . .
COPY --from=production-deps /app/vendor ./vendor
RUN mkdir -p var/cache var/log && chown -R www-data:www-data /app
USER www-data
EXPOSE 8080
CMD ["php", "-S", "0.0.0.0:8080", "-t", "public", "public/index.php"]
