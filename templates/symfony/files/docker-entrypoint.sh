#!/bin/sh
set -eu

# Never bake a shared secret into every generated image. The fallback makes a
# new stateless project runnable; persistent signed data needs a stable secret
# configured through InitPad's environment secrets.
if [ -z "${APP_SECRET:-}" ]; then
  APP_SECRET="$(php -r 'echo bin2hex(random_bytes(32));')"
  export APP_SECRET
fi

# php:alpine does not expose process environment variables in $_SERVER by
# default. Symfony Runtime reads APP_ENV and APP_SECRET there, so explicitly
# include E before starting the front controller.
php -d variables_order=EGPCS -r '
require "vendor/autoload.php";
$kernel = new App\Kernel(
    getenv("APP_ENV") ?: "prod",
    filter_var(getenv("APP_DEBUG") ?: "0", FILTER_VALIDATE_BOOL),
);
$kernel->boot();
$kernel->shutdown();
'

exec php \
  -d variables_order=EGPCS \
  -d display_errors=0 \
  -d log_errors=1 \
  -S 0.0.0.0:8080 \
  -t public \
  public/index.php
