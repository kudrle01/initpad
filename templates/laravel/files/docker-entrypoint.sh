#!/bin/sh
set -eu

# A generated project must boot before its owner has configured secrets.
# Keep the fallback out of the image and logs. For persistent encrypted data,
# configure a stable APP_KEY through InitPad's environment secrets.
if [ -z "${APP_KEY:-}" ]; then
  APP_KEY="$(php -r 'echo "base64:" . base64_encode(random_bytes(32));')"
  export APP_KEY
fi

exec php \
  -d variables_order=EGPCS \
  -d display_errors=0 \
  -d log_errors=1 \
  -S 0.0.0.0:8080 \
  -t public \
  public/index.php
