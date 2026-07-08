# Laravel is scaffolded at build time via Composer, then served by artisan.
FROM php:8.3-cli
ADD --chmod=0755 https://github.com/mlocati/docker-php-extension-installer/releases/latest/download/install-php-extensions /usr/local/bin/
RUN install-php-extensions pdo_sqlite mbstring bcmath
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
WORKDIR /app
RUN composer create-project laravel/laravel . --no-interaction --prefer-dist
EXPOSE 8080
CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8080"]
