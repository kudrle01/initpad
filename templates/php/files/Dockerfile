FROM php:8.3-cli-alpine AS base
WORKDIR /app
COPY . .

FROM base AS test
RUN php -l router.php

FROM base AS runtime
USER www-data
EXPOSE 8080
CMD ["php", "-S", "0.0.0.0:8080", "router.php"]
