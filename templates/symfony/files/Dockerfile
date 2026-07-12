# Symfony skeleton is scaffolded at build time; a minimal controller (copied
# from the repo) exposes / and /health as JSON so health checks pass.
FROM php:8.3-cli
ADD --chmod=0755 https://github.com/mlocati/docker-php-extension-installer/releases/latest/download/install-php-extensions /usr/local/bin/
RUN install-php-extensions intl ctype iconv zip
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
WORKDIR /app
RUN composer create-project symfony/skeleton . --no-interaction --prefer-dist \
 && composer require symfony/framework-bundle symfony/runtime --no-interaction
COPY config/routes.yaml config/routes.yaml
COPY src/Controller/AppController.php src/Controller/AppController.php
EXPOSE 8080
CMD ["php", "-S", "0.0.0.0:8080", "-t", "public", "public/index.php"]
