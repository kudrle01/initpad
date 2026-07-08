# Nette web-project is scaffolded at build time via Composer.
FROM php:8.3-cli
ADD --chmod=0755 https://github.com/mlocati/docker-php-extension-installer/releases/latest/download/install-php-extensions /usr/local/bin/
RUN install-php-extensions intl tokenizer
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
WORKDIR /app
RUN composer create-project nette/web-project . --no-interaction --prefer-dist \
 && chmod -R 777 temp log
EXPOSE 8080
CMD ["php", "-S", "0.0.0.0:8080", "-t", "www", "www/index.php"]
