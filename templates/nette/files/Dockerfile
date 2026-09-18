FROM php:8.5-cli-alpine@sha256:6cb4d855b2b63fd4792e76555a16211e2e4d8feab0ba770da080d774824eac92 AS base
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

FROM base AS runtime
COPY . .
COPY --from=production-deps /app/vendor ./vendor
RUN php -r "require 'vendor/autoload.php'; exit(class_exists('App\\Bootstrap') ? 0 : 1);"
RUN mkdir -p temp log && chown -R www-data:www-data /app
USER www-data
EXPOSE 8080
CMD ["php", "-S", "0.0.0.0:8080", "-t", "www", "www/index.php"]
