FROM php:8.3-cli-alpine@sha256:afdf8b1fee58486ccc0dab5f30f634b86873d56dac985f71ba217945647c05ad AS base
WORKDIR /app
COPY . .

FROM base AS test
RUN php -l router.php

FROM base AS runtime
USER www-data
EXPOSE 8080
CMD ["php", "-S", "0.0.0.0:8080", "router.php"]
