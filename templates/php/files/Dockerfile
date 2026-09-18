FROM php:8.5-cli-alpine@sha256:6cb4d855b2b63fd4792e76555a16211e2e4d8feab0ba770da080d774824eac92 AS base
WORKDIR /app
COPY . .

FROM base AS test
RUN php -l router.php

FROM base AS runtime
USER www-data
EXPOSE 8080
CMD ["php", "-S", "0.0.0.0:8080", "router.php"]
