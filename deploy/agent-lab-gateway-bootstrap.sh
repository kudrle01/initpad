#!/bin/sh
set -eu

name="${INITPAD_AGENT_GATEWAY_CONTAINER:-initpad-agent-lab-gateway}"
config=/bootstrap/agent-lab-caddy.json
config_sha="$(sha256sum "$config" | cut -d ' ' -f 1)"

if docker container inspect "$name" >/dev/null 2>&1; then
  managed="$(docker container inspect --format '{{ index .Config.Labels "com.initpad.gateway" }}' "$name")"
  installed_sha="$(docker container inspect --format '{{ index .Config.Labels "com.initpad.gateway.config-sha256" }}' "$name")"
  if [ "$managed" != true ]; then
    echo "Refusing to replace non-InitPad container named $name" >&2
    exit 1
  fi
  if [ "$installed_sha" = "$config_sha" ]; then
    docker container start "$name" >/dev/null
    exit 0
  fi
  docker container rm --force "$name" >/dev/null
fi

config_b64="$(base64 < "$config" | tr -d '\n')"
docker container run --detach \
  --name "$name" \
  --label com.initpad.gateway=true \
  --label "com.initpad.gateway.config-sha256=$config_sha" \
  --restart unless-stopped \
  --read-only \
  --tmpfs /tmp:size=4m,mode=1777 \
  --tmpfs /data:size=16m,mode=0700 \
  --tmpfs /config:size=8m,mode=0700 \
  --volume /var/lib/initpad-gateway-admin:/run/initpad-gateway \
  --cap-drop ALL \
  --cap-add NET_BIND_SERVICE \
  --security-opt no-new-privileges \
  --memory 64m \
  --cpus 0.15 \
  --pids-limit 64 \
  --publish 0.0.0.0:4180:8080 \
  --env "INITPAD_CADDY_CONFIG_B64=$config_b64" \
  --entrypoint /bin/sh \
  caddy:2.10-alpine \
  -ec 'rm -f /run/initpad-gateway/admin.sock; printf "%s" "$INITPAD_CADDY_CONFIG_B64" | base64 -d > /tmp/initpad.json; exec caddy run --config /tmp/initpad.json' \
  >/dev/null
