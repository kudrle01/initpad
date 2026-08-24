#!/bin/sh
set -eu

name="${INITPAD_AGENT_GATEWAY_CONTAINER:-initpad-agent-lab-gateway}"
config=/bootstrap/agent-lab-caddy.json
config_sha="$(sha256sum "$config" | cut -d ' ' -f 1)"
runtime_version=3
config_volume="${name}-config"
resume_config=''
managed_networks=''

if docker container inspect "$name" >/dev/null 2>&1; then
  managed="$(docker container inspect --format '{{ index .Config.Labels "com.initpad.gateway" }}' "$name")"
  installed_sha="$(docker container inspect --format '{{ index .Config.Labels "com.initpad.gateway.config-sha256" }}' "$name")"
  installed_runtime="$(docker container inspect --format '{{ index .Config.Labels "com.initpad.gateway.runtime-version" }}' "$name")"
  if [ "$managed" != true ]; then
    echo "Refusing to replace non-InitPad container named $name" >&2
    exit 1
  fi
  if [ "$installed_sha" = "$config_sha" ] && [ "$installed_runtime" = "$runtime_version" ]; then
    docker container start "$name" >/dev/null
    exit 0
  fi
  # The runtime-v1 lab kept Caddy's autosave on tmpfs. Preserve a bounded
  # canonical autosave across the storage migration only when it already has
  # the required HTTP-only inner listener. Older double-TLS configs are reset.
  docker container start "$name" >/dev/null
  resume_config="$(docker container exec "$name" sh -c \
    'test -s /config/caddy/autosave.json && cat /config/caddy/autosave.json' 2>/dev/null || true)"
  if [ "${#resume_config}" -gt 1048576 ]; then
    echo "Refusing to migrate an oversized Caddy autosave" >&2
    exit 1
  fi
  case "$resume_config" in
    *'"automatic_https":{"disable":true}'*) ;;
    *) resume_config='' ;;
  esac
  for network in $(docker container inspect --format \
    '{{range $network, $_ := .NetworkSettings.Networks}}{{println $network}}{{end}}' "$name"); do
    case "$network" in
      bridge) continue ;;
      *[!a-zA-Z0-9_.-]*) continue ;;
    esac
    network_managed="$(docker network inspect --format '{{ index .Labels "com.initpad.managed" }}' "$network" 2>/dev/null || true)"
    routing_mode="$(docker network inspect --format '{{ index .Labels "com.initpad.routing.mode" }}' "$network" 2>/dev/null || true)"
    if [ "$network_managed" = true ] && [ "$routing_mode" = managed-gateway ]; then
      managed_networks="$managed_networks $network"
    fi
  done
  docker container rm --force "$name" >/dev/null
fi

create_volume=true
if docker volume inspect "$config_volume" >/dev/null 2>&1; then
  volume_managed="$(docker volume inspect --format '{{ index .Labels "com.initpad.gateway" }}' "$config_volume")"
  if [ "$volume_managed" != true ]; then
    echo "Refusing to reuse non-InitPad volume named $config_volume" >&2
    exit 1
  fi
  volume_sha="$(docker volume inspect --format '{{ index .Labels "com.initpad.gateway.config-sha256" }}' "$config_volume")"
  if [ "$volume_sha" = "$config_sha" ]; then
    create_volume=false
  else
    docker volume rm "$config_volume" >/dev/null
  fi
fi

if [ "$create_volume" = true ]; then
  docker volume create \
    --label com.initpad.gateway=true \
    --label "com.initpad.gateway.config-sha256=$config_sha" \
    "$config_volume" >/dev/null
fi

if [ -n "$resume_config" ]; then
  resume_b64="$(printf '%s' "$resume_config" | base64 | tr -d '\n')"
  docker container run --rm \
    --volume "$config_volume:/config" \
    --env "INITPAD_CADDY_RESUME_B64=$resume_b64" \
    --entrypoint /bin/sh \
    caddy:2.10-alpine \
    -ec 'mkdir -p /config/caddy; printf "%s" "$INITPAD_CADDY_RESUME_B64" | base64 -d > /config/caddy/autosave.json; caddy validate --config /config/caddy/autosave.json' \
    >/dev/null
fi

config_b64="$(base64 < "$config" | tr -d '\n')"
docker container run --detach \
  --name "$name" \
  --label com.initpad.gateway=true \
  --label "com.initpad.gateway.config-sha256=$config_sha" \
  --label "com.initpad.gateway.runtime-version=$runtime_version" \
  --restart unless-stopped \
  --read-only \
  --tmpfs /tmp:size=4m,mode=1777 \
  --tmpfs /data:size=16m,mode=0700 \
  --volume "$config_volume:/config" \
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
  -ec 'rm -f /run/initpad-gateway/admin.sock; if [ -s /config/caddy/autosave.json ]; then exec caddy run --resume; fi; printf "%s" "$INITPAD_CADDY_CONFIG_B64" | base64 -d > /tmp/initpad.json; exec caddy run --config /tmp/initpad.json' \
  >/dev/null

for network in $managed_networks; do
  network_managed="$(docker network inspect --format '{{ index .Labels "com.initpad.managed" }}' "$network" 2>/dev/null || true)"
  routing_mode="$(docker network inspect --format '{{ index .Labels "com.initpad.routing.mode" }}' "$network" 2>/dev/null || true)"
  if [ "$network_managed" != true ] || [ "$routing_mode" != managed-gateway ]; then
    echo "Refusing to restore an unowned gateway network: $network" >&2
    exit 1
  fi
  docker network connect "$network" "$name"
done
