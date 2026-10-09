#!/bin/sh
set -eu

cd "$(dirname "$0")"

env_file=${1:-.env.saas}
[ -r "$env_file" ] || {
  echo "Missing $env_file. Start from .env.saas.example and configure secret file paths." >&2
  exit 1
}

fail() {
  echo "$*" >&2
  exit 1
}

duplicate_keys=$(awk -F= '
  $0 !~ /^[[:space:]]*(#|$)/ && $1 ~ /^[A-Za-z_][A-Za-z0-9_]*$/ {
    count[$1]++
  }
  END {
    for (key in count) {
      if (count[key] > 1) print key
    }
  }
' "$env_file" | LC_ALL=C sort)
[ -z "$duplicate_keys" ] || fail "SaaS environment contains duplicate keys: $duplicate_keys"

# Read only one literal KEY=value entry. The environment file is never sourced,
# so shell syntax or command substitutions in an operator-controlled value are
# not evaluated by this preflight.
env_value() {
  awk -F= -v key="$1" '
    $0 !~ /^[[:space:]]*#/ && $1 == key {
      sub(/^[^=]*=/, "")
      sub(/\r$/, "")
      print
      exit
    }
  ' "$env_file"
}

require_env_value() {
  value=$(env_value "$1")
  [ -n "$value" ] || fail "SaaS environment is missing $1."
  case "$value" in
    *REPLACE* | *.example | *.example/* | *.example:* | *://*.example | *://*.example/*)
      fail "SaaS environment still contains a placeholder in $1."
      ;;
  esac
}

for variable in \
  INITPAD_PUBLIC_URL \
  INITPAD_PLATFORM_VERSION \
  INITPAD_API_IMAGE \
  INITPAD_WEB_IMAGE \
  INITPAD_AGENT_IMAGE \
  INITPAD_AGENT_RELEASE_VERSION \
  INITPAD_ARTIFACT_S3_BUCKET \
  INITPAD_SMTP_HOST \
  INITPAD_SMTP_USERNAME \
  INITPAD_SMTP_FROM \
  INITPAD_GITHUB_APP_ID \
  INITPAD_GITHUB_CLIENT_ID \
  INITPAD_GITHUB_APP_SLUG \
  INITPAD_TRUST_PROXY_HOPS \
  INITPAD_WEB_BIND_ADDRESS \
  OTEL_EXPORTER_OTLP_ENDPOINT
do
  require_env_value "$variable"
done

public_url=$(env_value INITPAD_PUBLIC_URL)
case "$public_url" in
  https://*) ;;
  *) fail "INITPAD_PUBLIC_URL must use HTTPS." ;;
esac
case "$public_url" in
  *@* | *\?* | *\#*) fail "INITPAD_PUBLIC_URL must be an origin without credentials, query or fragment." ;;
esac
public_authority=${public_url#https://}
case "$public_authority" in
  '' | */*) fail "INITPAD_PUBLIC_URL must contain only an HTTPS origin without a path." ;;
esac

# The reviewed Compose topology has two and only two trusted proxies between
# the client and API: the deployment-owned public edge and the bundled web
# proxy. A smaller value rate-limits the edge instead of the client; a larger
# value lets an untrusted forwarding entry influence the security identity.
trust_proxy_hops=$(env_value INITPAD_TRUST_PROXY_HOPS)
[ "$trust_proxy_hops" = 2 ] || \
  fail "INITPAD_TRUST_PROXY_HOPS must be 2 for public edge -> web proxy -> API."

web_bind_address=$(env_value INITPAD_WEB_BIND_ADDRESS)
[ "$web_bind_address" = 127.0.0.1 ] || \
  fail "INITPAD_WEB_BIND_ADDRESS must be 127.0.0.1 so the public edge cannot be bypassed."

s3_endpoint=$(env_value INITPAD_ARTIFACT_S3_ENDPOINT)
case "$s3_endpoint" in
  '') ;;
  https://*) ;;
  *) fail "INITPAD_ARTIFACT_S3_ENDPOINT must be empty for AWS S3 or use HTTPS." ;;
esac

# Direct secret values would bypass the reviewed file projection boundary.
for variable in \
  DATABASE_URL \
  INITPAD_JWT_SECRET \
  INITPAD_ENCRYPTION_KEY \
  INITPAD_ENCRYPTION_KEY_PREVIOUS \
  INITPAD_SMTP_PASSWORD \
  INITPAD_SCM_WEBHOOK_TOKEN \
  INITPAD_OIDC_CLIENT_SECRET \
  INITPAD_GITHUB_CLIENT_SECRET \
  INITPAD_GITHUB_PRIVATE_KEY \
  INITPAD_GITHUB_WEBHOOK_SECRET \
  INITPAD_ARTIFACT_S3_ACCESS_KEY_ID \
  INITPAD_ARTIFACT_S3_SECRET_ACCESS_KEY
do
  [ -z "$(env_value "$variable")" ] || fail "SaaS secret $variable must be supplied through its _FILE setting."
done

project_root=$(cd .. && pwd -P)
for variable in \
  INITPAD_DATABASE_URL_FILE \
  INITPAD_JWT_SECRET_FILE \
  INITPAD_ENCRYPTION_KEY_FILE \
  INITPAD_SMTP_PASSWORD_FILE \
  INITPAD_GITHUB_CLIENT_SECRET_FILE \
  INITPAD_GITHUB_PRIVATE_KEY_FILE \
  INITPAD_GITHUB_WEBHOOK_SECRET_FILE \
  INITPAD_ARTIFACT_S3_ACCESS_KEY_ID_FILE \
  INITPAD_ARTIFACT_S3_SECRET_ACCESS_KEY_FILE
do
  secret_file=$(env_value "$variable")
  [ -n "$secret_file" ] || fail "SaaS environment is missing $variable."
  case "$secret_file" in
    /*) ;;
    *) fail "$variable must contain an absolute path." ;;
  esac
  case "$secret_file" in
    "$project_root" | "$project_root"/*)
      fail "$variable must point outside the source checkout."
      ;;
  esac
  [ -f "$secret_file" ] || fail "$variable does not point to a regular file."
  [ ! -L "$secret_file" ] || fail "$variable must not point to a symbolic link."
  [ -r "$secret_file" ] || fail "$variable is not readable."
  [ -s "$secret_file" ] || fail "$variable points to an empty file."
  secret_directory=$(cd "$(dirname "$secret_file")" && pwd -P)
  canonical_secret_file="$secret_directory/$(basename "$secret_file")"
  case "$canonical_secret_file" in
    "$project_root" | "$project_root"/*)
      fail "$variable must point outside the source checkout."
      ;;
  esac
done

compose() {
  docker compose --env-file "$env_file" -f saas.compose.yml "$@"
}

# `config --quiet` expands and validates the complete model without printing
# its environment. Secret values remain in read-only mounted files.
compose config --quiet

services=$(compose config --services | LC_ALL=C sort)
[ "$services" = "api
web" ] || {
  echo "SaaS profile must contain only api and web; got: $services" >&2
  exit 1
}

images=$(compose config --images)
count=0
for image in $images; do
  count=$((count + 1))
  case "$image" in
    *@sha256:????????????????????????????????????????????????????????????????) ;;
    *)
      echo "SaaS image is not digest-pinned: $image" >&2
      exit 1
      ;;
  esac
done
[ "$count" -eq 2 ] || {
  echo "Expected exactly two SaaS images, got $count" >&2
  exit 1
}

echo "SaaS Compose contract is valid: api + web, external dependencies, immutable images."
