FROM php:8.5-cli-alpine@sha256:aa66ee4275e0472bafcd18e35142499fcbda6ac90e641e751418e052e6a0d812 AS base
WORKDIR /app
COPY . .

FROM base AS test
RUN php -l router.php

FROM base AS runtime
USER www-data
EXPOSE 8080
CMD ["php", "-S", "0.0.0.0:8080", "router.php"]
