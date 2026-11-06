#!/bin/sh
set -eu

PROGRAM=initpad-agent-install
CONTAINER_NAME=initpad-agent
DATA_DIR=/var/lib/initpad-agent
CONTROL_PLANE_URL=
IMAGE=
ALLOW_INSECURE_HTTP=false
PUBLISHED_HOST=
GATEWAY_ADMIN_SOCKET=
GATEWAY_CONTAINER=
CA_FILE=
REENROLL=false
EXPECTED_TARGET_ID=
UNINSTALL=false
REMOVE_WORKLOADS=false
ASSUME_YES=false
SKIP_CAPACITY_CHECK=false
# Where Manage Agent stores the private CA for --ca-file (ADR-161).
MANAGED_CA_DIR=/etc/initpad-agent

usage() {
  cat <<'EOF'
Install, update or uninstall InitPad Agent on a Linux Docker server.

Usage:
  initpad-agent-install --url <control-plane-url> --image <image@sha256:digest> [options]
  initpad-agent-install --uninstall [--expected-target-id ID] [--remove-workloads] [--yes]

Required:
  --url URL                    Public InitPad control-plane URL
  --image IMAGE@sha256:DIGEST  Immutable Agent OCI image reference

Options:
  --allow-insecure-http        Permit HTTP for a trusted local test only
  --published-host HOST        Health-check host for a remote Docker daemon
  --gateway-admin-socket PATH  Private local Caddy admin Unix socket
  --gateway-container NAME     Labeled local Caddy gateway container
  --ca-file PATH               Private CA certificate trusted by the Agent
  --expected-target-id ID      Refuse an identity belonging to another target
  --re-enroll                  Replace a stale/revoked identity using a new token
  --skip-capacity-check        Do not stop on a server below the minimum size
  -h, --help                   Show this help

Uninstall:
  --uninstall                  Remove the Agent container, its saved identity
                               and the CA installed for it; keep applications
  --remove-workloads           Also remove the containers and networks InitPad
                               deployed for this target
  --yes                        Do not ask for confirmation

The enrollment token is requested by the Agent through a hidden terminal
prompt. It is never accepted as an argument or written to shell history.
EOF
}

fail() {
  printf '%s: %s\n' "$PROGRAM" "$1" >&2
  exit 1
}

warn() {
  printf '%s: warning: %s\n' "$PROGRAM" "$1" >&2
}

require_value() {
  [ "$#" -ge 2 ] || fail "$1 requires a value"
  [ -n "$2" ] || fail "$1 requires a non-empty value"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --url)
      require_value "$@"
      CONTROL_PLANE_URL=$2
      shift 2
      ;;
    --image)
      require_value "$@"
      IMAGE=$2
      shift 2
      ;;
    --allow-insecure-http)
      ALLOW_INSECURE_HTTP=true
      shift
      ;;
    --published-host)
      require_value "$@"
      PUBLISHED_HOST=$2
      shift 2
      ;;
    --gateway-admin-socket)
      require_value "$@"
      GATEWAY_ADMIN_SOCKET=$2
      shift 2
      ;;
    --gateway-container)
      require_value "$@"
      GATEWAY_CONTAINER=$2
      shift 2
      ;;
    --ca-file)
      require_value "$@"
      CA_FILE=$2
      shift 2
      ;;
    --expected-target-id)
      require_value "$@"
      EXPECTED_TARGET_ID=$2
      shift 2
      ;;
    --re-enroll)
      REENROLL=true
      shift
      ;;
    --skip-capacity-check)
      SKIP_CAPACITY_CHECK=true
      shift
      ;;
    --uninstall)
      UNINSTALL=true
      shift
      ;;
    --remove-workloads)
      REMOVE_WORKLOADS=true
      shift
      ;;
    --yes)
      ASSUME_YES=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "unknown argument: $1"
      ;;
  esac
done

[ "$(id -u)" -eq 0 ] || fail 'run this installer as root (for example with sudo)'
[ "$(uname -s)" = Linux ] || fail 'the production installer currently supports Linux Docker servers'

case "$EXPECTED_TARGET_ID" in
  *[!A-Za-z0-9_-]*) fail '--expected-target-id contains unsupported characters' ;;
esac

# ---- uninstall -----------------------------------------------------------
# Removes only what this installer and the Agent created: containers labeled
# com.initpad.agent, the identity directory, the CA copy Manage Agent
# installed (and Docker registry trust that is byte-identical to it) and, on
# request, workloads and networks labeled for exactly this target.
saved_target_id() {
  [ -f "$DATA_DIR/agent.json" ] || return 0
  sed -n 's/^[[:space:]]*"targetId":[[:space:]]*"\([^"]*\)"[,]*[[:space:]]*$/\1/p' "$DATA_DIR/agent.json"
}

agent_containers() {
  for name in "$CONTAINER_NAME" "${CONTAINER_NAME}-previous"; do
    docker container inspect "$name" >/dev/null 2>&1 || continue
    [ "$(docker container inspect --format '{{ index .Config.Labels "com.initpad.agent" }}' "$name")" = true ] \
      || fail "container name '$name' is used by an unmanaged container; it was not removed"
    printf '%s\n' "$name"
  done
}

managed_docker_ca_files() {
  [ -f "$MANAGED_CA_DIR/ca.crt" ] || return 0
  for file in /etc/docker/certs.d/*/ca.crt; do
    [ -f "$file" ] && cmp -s "$file" "$MANAGED_CA_DIR/ca.crt" && printf '%s\n' "$file"
  done
  return 0
}

uninstall_agent() {
  [ -L "$DATA_DIR" ] && fail "$DATA_DIR must not be a symbolic link"
  [ -L "$MANAGED_CA_DIR" ] && fail "$MANAGED_CA_DIR must not be a symbolic link"
  command -v docker >/dev/null 2>&1 || fail 'Docker Engine is required'
  docker info >/dev/null 2>&1 || fail 'Docker Engine is not reachable'

  target_id=$(saved_target_id) || exit 1
  if [ -n "$EXPECTED_TARGET_ID" ] && [ -n "$target_id" ] && [ "$target_id" != "$EXPECTED_TARGET_ID" ]; then
    fail "this server's Agent belongs to target '$target_id', not '$EXPECTED_TARGET_ID'; nothing was removed"
  fi
  target_id=${target_id:-$EXPECTED_TARGET_ID}
  if [ "$REMOVE_WORKLOADS" = true ] && [ -z "$target_id" ]; then
    fail '--remove-workloads needs --expected-target-id when no Agent identity is saved'
  fi

  containers=$(agent_containers) || exit 1
  ca_files=$(managed_docker_ca_files)
  workloads=
  networks=
  if [ "$REMOVE_WORKLOADS" = true ]; then
    workloads=$(docker ps -aq --filter label=com.initpad.managed=true \
      --filter "label=com.initpad.target=$target_id")
    networks=$(docker network ls -q --filter label=com.initpad.managed=true \
      --filter "label=com.initpad.target=$target_id")
  fi

  if [ -z "$containers$ca_files$workloads$networks" ] && [ ! -e "$DATA_DIR" ] && [ ! -e "$MANAGED_CA_DIR" ]; then
    printf 'InitPad Agent is not installed on this server; nothing to remove.\n'
    return 0
  fi

  printf 'This removes from this server:\n'
  [ -n "$containers" ] && printf '  - Agent container(s): %s\n' "$(printf '%s' "$containers" | tr '\n' ' ')"
  [ -d "$DATA_DIR" ] && printf '  - Agent identity: %s\n' "$DATA_DIR"
  [ -d "$MANAGED_CA_DIR" ] && printf '  - InitPad CA: %s\n' "$MANAGED_CA_DIR"
  for file in $ca_files; do printf '  - Docker registry trust: %s\n' "$file"; done
  if [ "$REMOVE_WORKLOADS" = true ]; then
    printf '  - %s application container(s) and %s network(s) of target %s\n' \
      "$(printf '%s' "$workloads" | grep -c . || true)" \
      "$(printf '%s' "$networks" | grep -c . || true)" "$target_id"
  else
    printf 'Applications deployed by InitPad keep running (add --remove-workloads to remove them).\n'
  fi

  if [ "$ASSUME_YES" != true ]; then
    [ -t 0 ] || fail 'run in an interactive terminal to confirm, or pass --yes'
    printf "Type 'uninstall' to continue: "
    IFS= read -r answer || answer=
    [ "$answer" = uninstall ] || fail 'cancelled; nothing was removed'
  fi

  images=
  for name in $containers; do
    images="$images $(docker container inspect --format '{{.Config.Image}}' "$name")"
    docker rm -f "$name" >/dev/null
  done
  if [ "$REMOVE_WORKLOADS" = true ]; then
    # shellcheck disable=SC2086
    [ -z "$workloads" ] || docker rm -f $workloads >/dev/null
    for network in $networks; do
      # A managed gateway outside this target may still be attached.
      for attached in $(docker network inspect --format '{{range .Containers}}{{.Name}} {{end}}' "$network"); do
        docker network disconnect -f "$network" "$attached" >/dev/null 2>&1 || true
      done
      docker network rm "$network" >/dev/null || warn "network $network could not be removed"
    done
  fi
  rm -rf "$DATA_DIR"
  for file in $ca_files; do
    rm -f "$file"
    rmdir "$(dirname "$file")" 2>/dev/null || true
  done
  rm -rf "$MANAGED_CA_DIR"
  for image in $images; do
    docker image rm "$image" >/dev/null 2>&1 || true
  done

  printf '\nInitPad Agent was removed from this server.\n'
  printf 'In InitPad, disconnect the Agent or delete this server so it is no longer shown as offline.\n'
}

if [ "$UNINSTALL" = true ]; then
  uninstall_agent
  exit 0
fi
[ "$REMOVE_WORKLOADS" = false ] || fail '--remove-workloads is only valid with --uninstall'

[ -n "$CONTROL_PLANE_URL" ] || fail '--url is required'
[ -n "$IMAGE" ] || fail '--image is required'

case "$CONTROL_PLANE_URL" in
  https://*) ;;
  http://*)
    [ "$ALLOW_INSECURE_HTTP" = true ] || fail 'HTTPS is required; use --allow-insecure-http only for a trusted local test'
    ;;
  *) fail '--url must be an absolute HTTP(S) URL' ;;
esac

printf '%s\n' "$IMAGE" | grep -Eq '^[A-Za-z0-9._:/-]+@sha256:[a-f0-9]{64}$' \
  || fail '--image must be an immutable OCI reference ending in @sha256:<64 lowercase hex characters>'

command -v docker >/dev/null 2>&1 || fail 'Docker Engine is required'
[ -S /var/run/docker.sock ] || fail '/var/run/docker.sock is not available'
docker info >/dev/null 2>&1 || fail 'Docker Engine is not reachable'

# ---- capacity
# The Agent and every deployed environment share this host. Below the minimum a
# server is only fit to run the Agent, and the kernel's out-of-memory killer
# can take the Agent or an application down, which looks like a disconnected
# server. Sizes are those of the Docker daemon's host. RAM is compared with a
# little headroom because a "1.5 GB" or "4 GB" VM reports less than its nominal
# size.
MIN_MEMORY_MIB=1400
REC_MEMORY_MIB=3600
MIN_CPUS=1
REC_CPUS=2
MIN_DISK_MIB=10240
REC_DISK_MIB=20480

check_capacity() {
  mem_bytes=$(docker info --format '{{.MemTotal}}' 2>/dev/null || echo 0)
  cpus=$(docker info --format '{{.NCPU}}' 2>/dev/null || echo 0)
  case "$mem_bytes" in ''|*[!0-9]*) mem_bytes=0 ;; esac
  case "$cpus" in ''|*[!0-9]*) cpus=0 ;; esac
  mem_mib=$((mem_bytes / 1048576))
  problems=
  notes=

  if [ "$mem_mib" -gt 0 ] && [ "$mem_mib" -lt "$MIN_MEMORY_MIB" ]; then
    problems="$problems
  - RAM: ${mem_mib} MiB available, at least 1.5 GB is required"
  elif [ "$mem_mib" -gt 0 ] && [ "$mem_mib" -lt "$REC_MEMORY_MIB" ]; then
    notes="$notes
  - RAM: ${mem_mib} MiB available, 4 GB is recommended for dev, test and prod"
  fi
  if [ "$cpus" -gt 0 ] && [ "$cpus" -lt "$MIN_CPUS" ]; then
    problems="$problems
  - CPU: ${cpus} available, at least ${MIN_CPUS} is required"
  elif [ "$cpus" -gt 0 ] && [ "$cpus" -lt "$REC_CPUS" ]; then
    notes="$notes
  - CPU: ${cpus} available, ${REC_CPUS} are recommended"
  fi

  # Free space is only measurable when the Docker daemon is on this host.
  if [ -z "$PUBLISHED_HOST" ]; then
    root_dir=$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)
    if [ -n "$root_dir" ] && [ -d "$root_dir" ]; then
      free_kib=$(df -Pk "$root_dir" 2>/dev/null | awk 'NR==2 {print $4}')
      case "$free_kib" in ''|*[!0-9]*) free_kib= ;; esac
      if [ -n "$free_kib" ]; then
        free_mib=$((free_kib / 1024))
        if [ "$free_mib" -lt "$MIN_DISK_MIB" ]; then
          problems="$problems
  - Disk: $((free_mib / 1024)) GiB free in $root_dir, at least 10 GiB is required"
        elif [ "$free_mib" -lt "$REC_DISK_MIB" ]; then
          notes="$notes
  - Disk: $((free_mib / 1024)) GiB free in $root_dir, 20 GiB is recommended"
        fi
      fi
    fi
  fi

  if [ -n "$notes" ]; then
    warn "this server is below the recommended size:$notes"
  fi
  if [ -n "$problems" ]; then
    if [ "$SKIP_CAPACITY_CHECK" = true ]; then
      warn "this server is below the minimum size; continuing because of --skip-capacity-check:$problems"
    else
      fail "this server is below the minimum size:$problems
Resize the server, or rerun with --skip-capacity-check to install anyway."
    fi
  fi
}
# ---- end capacity

check_capacity

# Do not silently modify the host's service policy. Some installations use a
# non-systemd or externally managed Docker daemon, but a conventional systemd
# host must enable Docker if the Agent is expected to recover after reboot.
if command -v systemctl >/dev/null 2>&1 \
  && [ "$(systemctl show docker.service --property=LoadState --value 2>/dev/null || true)" = loaded ] \
  && ! systemctl is-enabled --quiet docker.service; then
  warn 'Docker is running but docker.service is not enabled for host boot; run: sudo systemctl enable docker'
fi
[ -t 0 ] || fail 'run the installer in an interactive terminal so the enrollment token can be entered securely'

case "$PUBLISHED_HOST" in
  *[!A-Za-z0-9.:-]*) fail '--published-host contains unsupported characters' ;;
esac
case "$GATEWAY_CONTAINER" in
  *[!A-Za-z0-9_.-]*) fail '--gateway-container contains unsupported characters' ;;
esac

if [ -n "$GATEWAY_ADMIN_SOCKET" ]; then
  case "$GATEWAY_ADMIN_SOCKET" in
    /*) ;;
    *) fail '--gateway-admin-socket must be an absolute path' ;;
  esac
  printf '%s\n' "$GATEWAY_ADMIN_SOCKET" | grep -Eq '^/[A-Za-z0-9._/-]+$' \
    || fail '--gateway-admin-socket contains unsupported characters'
  [ -S "$GATEWAY_ADMIN_SOCKET" ] || fail 'the configured gateway admin socket does not exist or is not a Unix socket'
fi
if [ -n "$CA_FILE" ]; then
  case "$CA_FILE" in
    /*) ;;
    *) fail '--ca-file must be an absolute path' ;;
  esac
  printf '%s\n' "$CA_FILE" | grep -Eq '^/[A-Za-z0-9._/-]+$' \
    || fail '--ca-file contains unsupported characters'
  [ -f "$CA_FILE" ] || fail 'the configured CA file does not exist'
fi
if [ -n "$GATEWAY_ADMIN_SOCKET" ] || [ -n "$GATEWAY_CONTAINER" ]; then
  [ -n "$GATEWAY_ADMIN_SOCKET" ] && [ -n "$GATEWAY_CONTAINER" ] \
    || fail '--gateway-admin-socket and --gateway-container must be configured together'
fi

if [ -L "$DATA_DIR" ]; then
  fail "$DATA_DIR must not be a symbolic link"
fi
install -d -m 0700 "$DATA_DIR"

printf 'Pulling verified Agent image %s\n' "$IMAGE"
docker pull "$IMAGE"

run_agent_container() {
  trailing_options=$(printf '%s\n' "$@")
  set -- docker run
  set -- "$@" \
    --network host \
    --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock \
    --mount "type=bind,src=$DATA_DIR,dst=/var/lib/initpad-agent" \
    --env INITPAD_AGENT_CONFIG=/var/lib/initpad-agent/agent.json

  if [ -n "$PUBLISHED_HOST" ]; then
    set -- "$@" --env "INITPAD_AGENT_PUBLISHED_HOST=$PUBLISHED_HOST"
  fi
  if [ -n "$GATEWAY_ADMIN_SOCKET" ]; then
    gateway_dir=$(dirname "$GATEWAY_ADMIN_SOCKET")
    set -- "$@" \
      --mount "type=bind,src=$gateway_dir,dst=$gateway_dir,readonly" \
      --env "INITPAD_AGENT_GATEWAY_ADMIN_SOCKET=$GATEWAY_ADMIN_SOCKET" \
      --env "INITPAD_AGENT_GATEWAY_CONTAINER=$GATEWAY_CONTAINER"
  fi
  if [ -n "$CA_FILE" ]; then
    set -- "$@" \
      --mount "type=bind,src=$CA_FILE,dst=$CA_FILE,readonly" \
      --env "NODE_EXTRA_CA_CERTS=$CA_FILE"
  fi

  old_ifs=$IFS
  IFS='
'
  for option in $trailing_options; do
    set -- "$@" "$option"
  done
  IFS=$old_ifs
  "$@"
}

CONFIG_FILE=$DATA_DIR/agent.json

migrate_control_plane_url() {
  saved_url=$(sed -n 's/^[[:space:]]*"controlPlaneUrl":[[:space:]]*"\([^"]*\)"[,]*[[:space:]]*$/\1/p' \
    "$CONFIG_FILE")
  [ -n "$saved_url" ] || fail 'the saved Agent identity does not contain a readable control-plane URL'
  [ "$saved_url" != "$CONTROL_PLANE_URL" ] || return 0

  printf 'Verifying control-plane URL migration from %s to %s.\n' \
    "$saved_url" "$CONTROL_PLANE_URL"
  if [ "$ALLOW_INSECURE_HTTP" = true ]; then
    migration_output=$(run_agent_container --rm "$IMAGE" \
      migrate-url --url "$CONTROL_PLANE_URL" --allow-insecure-http 2>&1) || {
        printf '%s\n' "$migration_output" >&2
        fail 'the candidate Agent could not verify the new control-plane URL; the existing URL and identity were preserved'
      }
  else
    migration_output=$(run_agent_container --rm "$IMAGE" \
      migrate-url --url "$CONTROL_PLANE_URL" 2>&1) || {
        printf '%s\n' "$migration_output" >&2
        fail 'the candidate Agent could not verify the new control-plane URL; the existing URL and identity were preserved'
      }
  fi
  printf '%s\n' "$migration_output"
}

verify_identity_binding() {
  [ -n "$EXPECTED_TARGET_ID" ] || return 0
  [ -f "$CONFIG_FILE" ] || fail 'the Agent identity was not written after enrollment'

  saved_target_id=$(sed -n 's/^[[:space:]]*"targetId":[[:space:]]*"\([^"]*\)"[,]*[[:space:]]*$/\1/p' "$CONFIG_FILE")
  [ -n "$saved_target_id" ] || fail 'the saved Agent identity does not contain a readable target ID'
  if [ "$saved_target_id" != "$EXPECTED_TARGET_ID" ]; then
    fail "the saved Agent identity belongs to target '$saved_target_id', not intended target '$EXPECTED_TARGET_ID'; generate an enrollment token for the intended target and rerun this command with --re-enroll"
  fi
}

if [ ! -f "$CONFIG_FILE" ] || [ "$REENROLL" = true ]; then
  if [ -f "$CONFIG_FILE" ]; then
    printf '\nReplacing the existing Agent identity. The old credential will be revoked.\n'
  fi
  printf '\nPaste the single-use enrollment token when prompted.\n'
  if [ "$ALLOW_INSECURE_HTTP" = true ]; then
    run_agent_container --rm -it "$IMAGE" \
      enroll --url "$CONTROL_PLANE_URL" --allow-insecure-http
  else
    run_agent_container --rm -it "$IMAGE" \
      enroll --url "$CONTROL_PLANE_URL"
  fi
  verify_identity_binding
else
  printf 'Keeping the existing Agent identity in %s.\n' "$CONFIG_FILE"
  verify_identity_binding
  migrate_control_plane_url
  if ! identity_check=$(run_agent_container --rm "$IMAGE" once 2>&1); then
    printf '%s\n' "$identity_check" >&2
    fail 'the candidate Agent could not verify the existing identity; nothing was changed. Inspect the error above. If the identity was rejected because this target was disconnected, recreated or restored from another database, generate a new enrollment token and rerun this command with --re-enroll'
  fi
  printf 'Existing Agent identity verified.\n'
fi

PREVIOUS_CONTAINER=${CONTAINER_NAME}-previous
if docker container inspect "$PREVIOUS_CONTAINER" >/dev/null 2>&1; then
  previous_managed=$(docker container inspect --format '{{ index .Config.Labels "com.initpad.agent" }}' "$PREVIOUS_CONTAINER")
  [ "$previous_managed" = true ] \
    || fail "container name '$PREVIOUS_CONTAINER' is already used by an unmanaged container"
  if docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
    docker rm -f "$PREVIOUS_CONTAINER" >/dev/null
  else
    # Recover an update interrupted after the old container was parked but
    # before the replacement started.
    docker rename "$PREVIOUS_CONTAINER" "$CONTAINER_NAME"
    docker start "$CONTAINER_NAME" >/dev/null
  fi
fi

HAS_PREVIOUS=false
if docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  managed=$(docker container inspect --format '{{ index .Config.Labels "com.initpad.agent" }}' "$CONTAINER_NAME")
  [ "$managed" = true ] || fail "container name '$CONTAINER_NAME' is already used by an unmanaged container"
  docker stop "$CONTAINER_NAME" >/dev/null
  docker rename "$CONTAINER_NAME" "$PREVIOUS_CONTAINER"
  HAS_PREVIOUS=true
fi

start_agent() {
  run_agent_container -d \
    --name "$CONTAINER_NAME" \
    --label com.initpad.agent=true \
    --restart unless-stopped \
    --read-only \
    --tmpfs /tmp:size=16m,mode=1777 \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --memory 384m \
    --cpus 0.5 \
    --pids-limit 128 \
    --health-cmd 'node /app/dist/cli.js health' \
    --health-interval 30s \
    --health-timeout 10s \
    --health-retries 3 \
    --health-start-period 10s \
    "$IMAGE" run >/dev/null
  docker exec "$CONTAINER_NAME" node /app/dist/cli.js once >/dev/null
}

if ! start_agent; then
  printf '%s: the new Agent failed its control-plane heartbeat; restoring the previous container\n' "$PROGRAM" >&2
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  if [ "$HAS_PREVIOUS" = true ]; then
    docker rename "$PREVIOUS_CONTAINER" "$CONTAINER_NAME"
    docker start "$CONTAINER_NAME" >/dev/null
  fi
  exit 1
fi

if [ "$HAS_PREVIOUS" = true ]; then
  docker rm "$PREVIOUS_CONTAINER" >/dev/null
fi

printf '\nInitPad Agent is installed and started.\n'
printf '  Status: docker ps --filter name=^/%s$\n' "$CONTAINER_NAME"
printf '  Logs:   docker logs --tail=100 -f %s\n' "$CONTAINER_NAME"
printf '  Update: run this installer again with the new digest-pinned image\n'
