#!/usr/bin/env bash
# InitPad one-command installer.
#
#   ./install.sh            first run in a terminal asks how InitPad is reached
#                           (this computer, internal network, public domain)
#   ./install.sh --domain initpad.lab.example --tls internal
#                           the same without questions (see --help)
#   ./install.sh --reconfigure
#                           ask again, e.g. to move to another domain
#   ./install.sh --update-agent-release
#                           explicitly adopt the current reviewed Agent release
#
# Idempotent: safe to re-run. Requires Docker with the compose plugin.
# Fully fresh start: ./reset.sh && ./install.sh
set -euo pipefail
cd "$(dirname "$0")"

COMPOSE="docker compose"
say()  { printf '\033[1;32m›\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
fail() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }
random_secret() {
  openssl rand -hex 24 2>/dev/null || head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'
}

usage() {
  cat <<EOF
Usage: $0 [options]

Network (written to deploy/.env; asked interactively on the first run):
  --local                 only this computer: http://localhost
  --domain NAME           platform hostname, e.g. initpad.lab.example
  --git-domain NAME       Git hostname (default: git.<parent of --domain>)
  --tls internal|public   internal = certificates from InitPad's own CA for a
                          network with its own DNS (domain controller);
                          public = Let's Encrypt, needs ports 80/443 reachable
                          from the internet. Default: internal for .local,
                          .internal, .lan, .home.arpa and .test, else public.
  --reconfigure           ask the network questions again

Other:
  --update-agent-release  replace the configured Agent distribution with the
                          reviewed repository release
  -h, --help              show this help
EOF
}

UPDATE_AGENT_RELEASE=no
RECONFIGURE=no
ARG_LOCAL=no
ARG_DOMAIN=
ARG_GIT_DOMAIN=
ARG_TLS=
need_value() { [ "$#" -ge 2 ] && [ -n "$2" ] || fail "$1 requires a value (try --help)."; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --update-agent-release) UPDATE_AGENT_RELEASE=yes ;;
    --reconfigure) RECONFIGURE=yes ;;
    --local) ARG_LOCAL=yes ;;
    --domain) need_value "$@"; ARG_DOMAIN=$2; shift ;;
    --domain=*) ARG_DOMAIN=${1#*=} ;;
    --git-domain) need_value "$@"; ARG_GIT_DOMAIN=$2; shift ;;
    --git-domain=*) ARG_GIT_DOMAIN=${1#*=} ;;
    --tls) need_value "$@"; ARG_TLS=$2; shift ;;
    --tls=*) ARG_TLS=${1#*=} ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown option: $1 (try --help)." ;;
  esac
  shift
done
if [ "$ARG_LOCAL" = yes ] && [ -n "$ARG_DOMAIN$ARG_GIT_DOMAIN$ARG_TLS" ]; then
  fail "--local cannot be combined with --domain, --git-domain or --tls."
fi
if [ -z "$ARG_DOMAIN" ] && [ -n "$ARG_GIT_DOMAIN$ARG_TLS" ]; then
  fail "--git-domain and --tls require --domain."
fi
case "$ARG_TLS" in ''|internal|public) ;; *) fail "--tls must be 'internal' or 'public'." ;; esac

command -v docker >/dev/null || fail "Docker is not installed (https://docs.docker.com/get-docker/)."
docker info >/dev/null 2>&1 || fail "Docker daemon is not running."
docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is missing."
[ -z "$(docker ps -q --filter label=com.initpad.platform-update)" ] || \
  fail "A signed platform update is currently running; wait for it to finish."

rootless_restriction=/proc/sys/kernel/apparmor_restrict_unprivileged_userns
rootless_profile=/etc/apparmor.d/usr.local.bin.rootlesskit
if [ -e "$rootless_restriction" ] && [ "$(cat "$rootless_restriction")" = 1 ]; then
  if [ ! -f "$rootless_profile" ] ||
    ! grep -Eq '^[[:space:]]*/usr/local/bin/rootlesskit[[:space:]]+flags=\(unconfined\)' "$rootless_profile" ||
    ! grep -Eq '^[[:space:]]*userns,[[:space:]]*$' "$rootless_profile"; then
    fail "Ubuntu AppArmor blocks the isolated rootless CI daemon.
Run:  sudo ./prepare-rootless-runner.sh
Then re-run ./install.sh. The global user-namespace restriction will stay enabled."
  fi
fi

# ---- 1. configuration + secrets --------------------------------------------
FRESH_ENV=no
if [ ! -f .env ]; then
  say "Creating .env from .env.example"
  cp .env.example .env
  FRESH_ENV=yes
fi
chmod 600 .env

get_env() { awk -F= -v k="$1" '$1==k {sub(/^[^=]*=/, ""); print; exit}' .env; }
set_env() {
  local tmp; tmp=$(mktemp)
  awk -v k="$1" -v v="$2" 'BEGIN{FS=OFS="="} $1==k {$0=k"="v; done=1} {print} END{if(!done) print k"="v}' .env > "$tmp"
  mv "$tmp" .env
  chmod 600 .env
}

# This stack bundles Gitea, an S3 object store, a CI runner and the Docker socket; the SaaS
# edition has its own profile without them (ADR-153).
if [ "$(get_env INITPAD_EDITION)" = "saas" ]; then
  fail "INITPAD_EDITION=saas is not installed by this script. Deploy the SaaS edition with saas.compose.yml (see SAAS_STAGING.md)."
fi

# ---- network: how browsers, Git clients and Agents reach this instance -------
# One answer (or flag) fills every address variable consistently, so an
# operator never has to edit the split between browser-facing and internal
# addresses by hand (ADR-161).
valid_hostname() {
  printf '%s\n' "$1" | grep -Eq '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' &&
    [ "${#1}" -le 253 ]
}
normalize_hostname() { # lower-case, without scheme, path, port or trailing dot
  local h
  h=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')
  h=${h#http://}; h=${h#https://}; h=${h%%/*}; h=${h%%:*}; h=${h%.}
  printf '%s' "$h"
}
default_git_domain() { # git.<parent> for a.b.c, git.<name> for b.c
  local d=$1 parent=${1#*.}
  case "$parent" in *.*) printf 'git.%s' "$parent" ;; *) printf 'git.%s' "$d" ;; esac
}
default_tls_mode() {
  case "$1" in
    *.local|*.internal|*.lan|*.home.arpa|*.test|*.intranet|*.corp) printf internal ;;
    *) printf public ;;
  esac
}
server_ip() {
  ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") {print $(i+1); exit}}' ||
    true
}

apply_local_network() {
  local web_port gitea_port
  web_port=$(get_env INITPAD_WEB_PORT); web_port=${web_port:-8080}
  gitea_port=$(get_env INITPAD_GITEA_HTTP_PORT); gitea_port=${gitea_port:-3001}
  set_env INITPAD_PUBLIC_URL "http://localhost:$web_port"
  set_env INITPAD_GITEA_PUBLIC_URL "http://gitea.localhost:$gitea_port"
  set_env INITPAD_REGISTRY_HOST "127.0.0.1:$gitea_port"
  set_env INITPAD_CI_REGISTRY_HOST "host.docker.internal:$gitea_port"
  set_env INITPAD_GITEA_RUNNER_URL "http://host.docker.internal:$gitea_port"
  set_env INITPAD_DOMAIN ""
  set_env INITPAD_GIT_DOMAIN ""
  set_env INITPAD_TLS_DIRECTIVE ""
  say "Network: this computer only (http://localhost:$web_port)"
}

apply_domain_network() { # <platform domain> <git domain> <internal|public>
  local domain=$1 git=$2 tls=$3 gitea_port
  gitea_port=$(get_env INITPAD_GITEA_HTTP_PORT); gitea_port=${gitea_port:-3001}
  set_env INITPAD_DOMAIN "$domain"
  set_env INITPAD_GIT_DOMAIN "$git"
  set_env INITPAD_PUBLIC_URL "https://$domain"
  set_env INITPAD_GITEA_PUBLIC_URL "https://$git"
  # The host daemon, Agent servers and CI jobs all address the registry by the
  # Git hostname; with an internal CA install.sh makes each daemon trust it.
  set_env INITPAD_REGISTRY_HOST "$git"
  set_env INITPAD_CI_REGISTRY_HOST "$git"
  if [ "$tls" = internal ]; then
    set_env INITPAD_TLS_DIRECTIVE "tls internal"
    # Checkout jobs clone over the private same-host port, so the throwaway
    # job images never need the CA (the nested daemon gets it for the registry).
    set_env INITPAD_GITEA_RUNNER_URL "http://host.docker.internal:$gitea_port"
    say "Network: https://$domain and https://$git with certificates from InitPad's own CA"
  else
    set_env INITPAD_TLS_DIRECTIVE ""
    set_env INITPAD_GITEA_RUNNER_URL "https://$git"
    say "Network: https://$domain and https://$git with Let's Encrypt certificates"
  fi
}

check_domain_pair() { # <platform domain> <git domain>
  valid_hostname "$1" || fail "'$1' is not a valid hostname (e.g. initpad.lab.example)."
  valid_hostname "$2" || fail "'$2' is not a valid hostname (e.g. git.lab.example)."
  [ "$1" != "$2" ] || fail "The platform and Git need two different hostnames."
}

report_dns() { # <name>... — warn when a name does not resolve to this server
  local ip name resolved
  ip=$(server_ip)
  for name in "$@"; do
    resolved=$(getent ahostsv4 "$name" 2>/dev/null | awk 'NR==1 {print $1}' || true)
    if [ -z "$resolved" ]; then
      warn "$name does not resolve yet. Create a DNS A record $name → ${ip:-<IP of this server>}."
      case "$name" in
        *.local)
          if systemctl is-active --quiet systemd-resolved 2>/dev/null; then
            warn "If the record exists, systemd-resolved is not sending .local names to your DNS server (it treats them as mDNS). Tell it which server answers the whole zone, then repeat: printf '[Resolve]\\nDNS=<ip of your DNS server>\\nDomains=~${name#*.}\\n' | sudo tee /etc/systemd/resolved.conf.d/initpad-zone.conf && sudo systemctl restart systemd-resolved. Prefer .lan, home.arpa or a subdomain you own over .local."
          fi
          ;;
      esac
    elif [ -n "$ip" ] && [ "$resolved" != "$ip" ] && [ "${resolved%%.*}" != 127 ]; then
      warn "$name resolves to $resolved, but this server's address is $ip."
    fi
  done
}

ask() { # <prompt> <default> → answer on stdout
  local answer
  if [ -n "$2" ]; then printf '%s [%s]: ' "$1" "$2" >&2; else printf '%s: ' "$1" >&2; fi
  IFS= read -r answer || answer=
  printf '%s' "${answer:-$2}"
}

network_wizard() {
  local current_domain current_git current_tls choice default_choice domain git tls ip answer
  current_domain=$(get_env INITPAD_DOMAIN || true)
  current_git=$(get_env INITPAD_GIT_DOMAIN || true)
  current_tls=$(get_env INITPAD_TLS_DIRECTIVE || true)
  default_choice=1
  if [ -n "$current_domain" ]; then
    if [ "$current_tls" = "tls internal" ]; then default_choice=2; else default_choice=3; fi
  fi
  ip=$(server_ip)

  cat >&2 <<EOF

  How will people reach this InitPad?

    1) Only this computer          http://localhost:8080
    2) Internal network with DNS   e.g. names on your domain controller; HTTPS
                                   with InitPad's own certificate authority
    3) Public internet domain      HTTPS from Let's Encrypt; ports 80 and 443
                                   must be reachable from the internet

EOF
  while :; do
    choice=$(ask "  Choice" "$default_choice")
    case "$choice" in 1|2|3) break ;; esac
    printf '  Enter 1, 2 or 3.\n' >&2
  done
  if [ "$choice" = 1 ]; then
    apply_local_network
    return
  fi
  [ "$choice" = 2 ] && tls=internal || tls=public

  printf '\n  InitPad needs two hostnames that point to this server%s:\n' \
    "${ip:+ ($ip)}" >&2
  printf '  one for the platform and one for Git and its image registry.\n\n' >&2
  while :; do
    domain=$(normalize_hostname "$(ask "  Platform hostname" "${current_domain:-}")")
    valid_hostname "$domain" && break
    printf '  Enter a hostname such as initpad.lab.example.\n' >&2
  done
  if [ -n "$current_git" ] && [ "$domain" = "$current_domain" ]; then
    git=$current_git
  else
    git=$(default_git_domain "$domain")
  fi
  while :; do
    git=$(normalize_hostname "$(ask "  Git hostname" "$git")")
    valid_hostname "$git" && [ "$git" != "$domain" ] && break
    printf '  Enter a hostname different from %s.\n' "$domain" >&2
  done
  case "$domain $git" in
    *.local\ *|*.local)
      printf '\n  Note: .local is also used by mDNS (Bonjour, Avahi). Windows clients in\n' >&2
      printf '  the domain resolve it through DNS; Linux and macOS may need a\n' >&2
      printf '  configuration change. A subdomain of a real domain avoids this.\n' >&2
      ;;
  esac
  printf '\n  Create these DNS records (A) before using InitPad:\n' >&2
  printf '    %-40s → %s\n' "$domain" "${ip:-<this server>}" "$git" "${ip:-<this server>}" >&2
  printf '\n' >&2
  answer=$(ask "  Continue? (Y/n)" "Y")
  case "$answer" in [Nn]*) fail "Cancelled. Run ./install.sh --reconfigure to start again." ;; esac
  apply_domain_network "$domain" "$git" "$tls"
}

if [ "$ARG_LOCAL" = yes ]; then
  apply_local_network
elif [ -n "$ARG_DOMAIN" ]; then
  domain=$(normalize_hostname "$ARG_DOMAIN")
  if [ -n "$ARG_GIT_DOMAIN" ]; then
    git_domain=$(normalize_hostname "$ARG_GIT_DOMAIN")
  else
    git_domain=$(default_git_domain "$domain")
  fi
  check_domain_pair "$domain" "$git_domain"
  tls_mode=${ARG_TLS:-$(default_tls_mode "$domain")}
  apply_domain_network "$domain" "$git_domain" "$tls_mode"
elif [ "$FRESH_ENV" = yes ] || [ "$RECONFIGURE" = yes ]; then
  if [ -t 0 ] && [ -t 2 ]; then
    network_wizard
  elif [ "$RECONFIGURE" = yes ]; then
    fail "--reconfigure needs a terminal; pass --local or --domain instead."
  else
    say "No terminal: installing for this computer only (use --domain for a server)"
  fi
fi

# Installations configured by hand for the internal CA before ADR-161 sent CI
# checkouts to the public Git URL, which throwaway job images do not trust.
if [ "$(get_env INITPAD_TLS_DIRECTIVE || true)" = "tls internal" ] &&
  [ "$(get_env INITPAD_GITEA_RUNNER_URL || true)" = "$(get_env INITPAD_GITEA_PUBLIC_URL || true)" ]; then
  gitea_port=$(get_env INITPAD_GITEA_HTTP_PORT); gitea_port=${gitea_port:-3001}
  set_env INITPAD_GITEA_RUNNER_URL "http://host.docker.internal:$gitea_port"
fi

# Reconcile generated secrets from the current example into legacy installs.
# Existing non-empty values are intentionally preserved. This makes adding a
# new required secret safe for in-place upgrades instead of requiring an
# operator to copy it into an older .env by hand.
while IFS= read -r key; do
  value=$(get_env "$key")
  if [ -z "$value" ] || [ "$value" = __GENERATE__ ]; then
    set_env "$key" "$(random_secret)"
  fi
done < <(awk -F= '$2=="__GENERATE__" {print $1}' .env.example)
say "Secrets are in place"

# The Supervisor mounts this checkout read-only at the same absolute path so
# its separately launched helper can use the reviewed Compose file. Recompute
# it on every install because a checkout may have been moved.
install_root=$(cd .. && pwd -P)
case "$install_root" in *$'\n'*|*$'\r'*) fail "Install path contains a newline.";; esac
set_env INITPAD_INSTALL_ROOT "$install_root"
set_env COMPOSE_FILE "docker-compose.yml:.runtime/platform-update/platform-release.override.yml"
runtime_update_dir=.runtime/platform-update
runtime_override=$runtime_update_dir/platform-release.override.yml
mkdir -p "$runtime_update_dir"
chmod 700 "$runtime_update_dir"
# Public CA certificate for the internal-TLS mode; mounted into the API and
# the CI daemon, so it must exist before Compose would create it as root.
mkdir -p .runtime/tls
[ -w .runtime/tls ] || fail "deploy/.runtime/tls is not writable (Docker may have created it as root).
Run:  sudo chown \"\$(id -u):\$(id -g)\" '$PWD/.runtime/tls'   and re-run ./install.sh."
if [ ! -f "$runtime_override" ]; then
  printf 'services: {}\n' > "$runtime_override"
  chmod 600 "$runtime_override"
fi
platform_version=$(awk -F'"' '/"version"[[:space:]]*:/ { print $4; exit }' platform-version.json)
printf '%s\n' "$platform_version" | \
  grep -Eq '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' || \
  fail "deploy/platform-version.json contains an invalid version."
set_env INITPAD_PLATFORM_VERSION "$platform_version"

# A signed release installed by the Supervisor pins its own images, while
# Compose reads docker-compose.yml from this checkout. After `git pull` they
# describe different versions, and a newer Compose file would start older
# images it was not written for (an older web image cannot run read-only, for
# example). The source checkout is what the operator just updated, so it wins;
# a checkout older than the installed release is refused instead.
release_version=$(sed -n 's/^ *INITPAD_PLATFORM_VERSION: *"\{0,1\}\([0-9][0-9.]*\)"\{0,1\} *$/\1/p' \
  "$runtime_override" | head -n 1)
if [ -n "$release_version" ] && [ "$release_version" != "$platform_version" ]; then
  newest=$(printf '%s\n%s\n' "$release_version" "$platform_version" |
    sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)
  if [ "$newest" = "$platform_version" ]; then
    superseded="$runtime_override.superseded-$release_version"
    cp -p "$runtime_override" "$superseded"
    printf 'services: {}\n' > "$runtime_override"
    chmod 600 "$runtime_override"
    warn "The installed signed release $release_version is older than this checkout ($platform_version).
  The platform is now built from this checkout; the release descriptor was kept in
  deploy/$superseded."
  else
    fail "The installed signed release $release_version is newer than this checkout ($platform_version).
Switch the checkout to that release and re-run ./install.sh:
  git fetch --tags && git switch --detach initpad-v$release_version"
  fi
fi

# A normal self-hosted installation should immediately offer the reviewed,
# checksum-verified Agent installer. Preserve a complete operator override,
# but populate blank fresh/legacy environments from the versioned release pair.
if [ "$UPDATE_AGENT_RELEASE" = yes ]; then
  ./configure-agent-release.sh --update
else
  ./configure-agent-release.sh
fi

# Upgrade existing installations from the former global CI token. It is now
# used only for the Gitea system webhook; repository CI credentials are
# rotated independently by the API on startup.
if [ -z "$(get_env INITPAD_SCM_WEBHOOK_TOKEN)" ]; then
  legacy=$(get_env INITPAD_CI_DEPLOY_TOKEN)
  if [ -n "$legacy" ]; then
    set_env INITPAD_SCM_WEBHOOK_TOKEN "$legacy"
  else
    set_env INITPAD_SCM_WEBHOOK_TOKEN "$(random_secret)"
  fi
fi
if [ -z "$(get_env INITPAD_REGISTRATION_MODE)" ]; then
  set_env INITPAD_REGISTRATION_MODE admin-provisioned
fi
# Local upgrades use a dedicated .localhost hostname so browsers resolve it
# to loopback while isolated CI jobs map the same name to their gateway.
if [ "$(get_env INITPAD_GITEA_PUBLIC_URL)" = "http://localhost:3001" ]; then
  set_env INITPAD_GITEA_PUBLIC_URL http://gitea.localhost:3001
fi
# The host daemon pulls from the host-published registry. A literal IPv4
# loopback is portable across Docker Desktop and plain Linux; *.localhost can
# resolve to ::1 on Fedora even when the published port only accepts IPv4.
registry_host=$(get_env INITPAD_REGISTRY_HOST)
case "$registry_host" in
  localhost:*|gitea.localhost:*)
    set_env INITPAD_REGISTRY_HOST "127.0.0.1:${registry_host##*:}"
    ;;
esac
# CI jobs cannot use *.localhost: glibc gives the reserved suffix an IPv6
# loopback result before Docker's host mapping. Local jobs use the explicit
# host gateway; a server install uses its real public Git hostname.
if [ -z "$(get_env INITPAD_GITEA_RUNNER_URL)" ]; then
  public_gitea=$(get_env INITPAD_GITEA_PUBLIC_URL)
  gitea_port=$(get_env INITPAD_GITEA_HTTP_PORT); gitea_port=${gitea_port:-3001}
  case "$public_gitea" in
    http://gitea.localhost:*|http://localhost:*)
      set_env INITPAD_GITEA_RUNNER_URL "http://host.docker.internal:$gitea_port"
      ;;
    *) set_env INITPAD_GITEA_RUNNER_URL "$public_gitea" ;;
  esac
fi
if [ -z "$(get_env INITPAD_CI_REGISTRY_HOST)" ]; then
  registry_host=$(get_env INITPAD_REGISTRY_HOST)
  gitea_port=$(get_env INITPAD_GITEA_HTTP_PORT); gitea_port=${gitea_port:-3001}
  case "$registry_host" in
    127.0.0.1:*|gitea.localhost:*|localhost:*)
      set_env INITPAD_CI_REGISTRY_HOST "host.docker.internal:$gitea_port"
      ;;
    *) set_env INITPAD_CI_REGISTRY_HOST "$registry_host" ;;
  esac
fi
# act_runner reads capacity only from YAML and does not interpolate environment
# variables there. Render the validated runtime config before any runner
# migration or startup command asks Compose to mount it.
./render-runner-config.sh
runner_config_changed=no
[ -f .runtime/runner-config.changed ] && runner_config_changed=yes
wait_healthy() { # <service> [attempts]
  local svc=$1 tries=${2:-60} cid state
  for i in $(seq 1 "$tries"); do
    cid=$($COMPOSE ps -q "$svc" 2>/dev/null || true)
    state=$(docker inspect --format '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo starting)
    [ "$state" = healthy ] && return 0
    sleep 2
  done
  if [ "$svc" = runner-docker ] &&
    $COMPOSE --profile runner logs --no-color runner-docker 2>&1 | \
      grep -q 'rootlesskit.*operation not permitted'; then
    fail "runner-docker is blocked by the host AppArmor user-namespace policy.
Run:  sudo ./prepare-rootless-runner.sh
Then re-run ./install.sh."
  fi
  fail "$svc did not become healthy — check: docker compose logs $svc"
}

# act_runner persists the instance URL in /data/.runner. Changing the Compose
# environment alone therefore does not repair existing installations: checkout
# jobs would keep receiving the old internal-only `http://gitea:3000` address.
# Rotate the runner identity when its stored address differs. The exact old DB
# row is removed while Gitea is stopped, which also invalidates the old runner
# authentication token; no credential is ever printed by this migration.
rotate_runner_if_address_changed() {
  local desired state stored runner_id runner_name runner_uuid known deleted
  desired=$(get_env INITPAD_GITEA_RUNNER_URL)
  desired=${desired:-http://host.docker.internal:3001}
  desired=${desired%/}

  state=$($COMPOSE --profile runner run --rm --no-deps --entrypoint sh act_runner -c \
    "test ! -f /data/.runner || sed -n \
      's/.*\"id\"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/id=\1/p;
       s/.*\"name\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/name=\1/p;
       s/.*\"uuid\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/uuid=\1/p;
       s/.*\"address\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/address=\1/p' \
      /data/.runner" 2>/dev/null || true)
  stored=$(printf '%s\n' "$state" | awk -F= '$1=="address" {sub(/^address=/, ""); print; exit}')
  stored=${stored%/}
  [ -z "$stored" ] && return 0
  if [ "$stored" = "$desired" ]; then
    # The runner volume outlives a recreated Gitea, e.g. after `docker compose
    # down -v` without --profile runner. A new Gitea may reuse the same id and
    # name, so only the uuid tells the registrations apart. Act_runner would
    # keep failing with "unregistered runner" and never register again.
    runner_uuid=$(printf '%s\n' "$state" | awk -F= '$1=="uuid" {print $2; exit}')
    case "$runner_uuid" in ''|*[!0-9a-f-]*) fail "Stored CI runner uuid is invalid; refusing an unsafe check.";; esac
    known=$($COMPOSE exec -T -u git gitea sqlite3 -readonly /data/gitea/gitea.db \
      "SELECT count(*) FROM action_runner WHERE uuid='$runner_uuid' AND (deleted IS NULL OR deleted=0);" \
      2>/dev/null | tr -d '\r' | tail -n 1 || true)
    case "$known" in
      1) ;;
      0)
        say "Discarding a CI runner registration that this Gitea does not know"
        $COMPOSE --profile runner stop act_runner >/dev/null 2>&1 || true
        $COMPOSE --profile runner run --rm --no-deps --entrypoint sh act_runner \
          -c 'rm -f /data/.runner'
        ;;
      *) warn "Could not check the CI runner registration against Gitea." ;;
    esac
    return 0
  fi

  runner_id=$(printf '%s\n' "$state" | awk -F= '$1=="id" {print $2; exit}')
  runner_name=$(printf '%s\n' "$state" | awk -F= '$1=="name" {sub(/^name=/, ""); print; exit}')
  case "$runner_id" in ''|*[!0-9]*) fail "Stored CI runner id is invalid; refusing an unsafe rotation.";; esac
  [ "$runner_name" = initpad-runner ] || \
    fail "Stored CI runner name is unexpected; remove it manually before continuing."

  say "Rotating CI runner registration for reachable checkout URL"
  $COMPOSE stop act_runner api gitea >/dev/null
  deleted=$($COMPOSE run --rm --no-deps -T -u git --entrypoint sqlite3 gitea \
    /data/gitea/gitea.db \
    "BEGIN IMMEDIATE; DELETE FROM action_runner WHERE id=$runner_id AND name='initpad-runner'; SELECT changes(); COMMIT;" \
    | tr -d '\r' | tail -1)
  case "$deleted" in 0|1) ;; *)
    $COMPOSE up -d gitea api >/dev/null 2>&1 || true
    fail "Could not invalidate the previous CI runner registration."
  esac
  $COMPOSE --profile runner run --rm --no-deps --entrypoint sh act_runner \
    -c 'rm -f /data/.runner'
  $COMPOSE up -d gitea
  wait_healthy gitea 60
  $COMPOSE up -d api
  wait_healthy api 60
}

BOT_USER=$(get_env INITPAD_BOT_USER); BOT_USER=${BOT_USER:-initpad-bot}
BOT_PASSWORD=$(get_env INITPAD_BOT_PASSWORD)
OIDC_SECRET=$(get_env INITPAD_OIDC_CLIENT_SECRET)
DB_PASSWORD=$(get_env INITPAD_DB_PASSWORD)
DOMAIN=$(get_env INITPAD_DOMAIN || true)

# Both names are needed by browsers, Agents and the CI runner. Say so now, not
# after an hour of failed builds.
if [ -n "${DOMAIN:-}" ]; then
  report_dns "$DOMAIN" "$(get_env INITPAD_GIT_DOMAIN || true)"
fi

# ---- 2. core services -------------------------------------------------------
say "Starting core services (postgres, gitea, deployment targets)"
$COMPOSE up -d postgres gitea fake-sftp static-web

say "Waiting for PostgreSQL"
wait_healthy postgres 30
# A pre-existing database volume keeps the password it was initialized with.
# Verify that .env matches it; otherwise the API cannot connect later. Connect
# through the Compose network as the API does: the image trusts loopback
# connections without any password, so a check over 127.0.0.1 always passed.
if ! $COMPOSE exec -T -e PGPASSWORD="$DB_PASSWORD" postgres \
    psql -h postgres -U initpad -d initpad -c 'select 1' >/dev/null 2>&1; then
  fail "The existing database volume was initialized with a different password
  than INITPAD_DB_PASSWORD in .env. Either restore the original .env, or start
  fresh (deletes all platform data):  ./reset.sh && ./install.sh"
fi

say "Waiting for Gitea"
wait_healthy gitea 60

# The gitea CLI needs the config path and must run as the 'git' user.
GITEA_CONF=$($COMPOSE exec -T gitea sh -c \
  'test -f /data/gitea/conf/app.ini && echo /data/gitea/conf/app.ini || find /data -name app.ini 2>/dev/null | head -1' | tr -d '\r\n')
[ -n "$GITEA_CONF" ] || fail "Gitea app.ini not found."
GITEA_WORK=$(dirname "$(dirname "$GITEA_CONF")")
gitea_cli() { $COMPOSE exec -T -u git gitea gitea --work-path "$GITEA_WORK" --config "$GITEA_CONF" "$@"; }

# ---- 3. bootstrap: service account + tokens ---------------------------------
if gitea_cli admin user list 2>/dev/null | awk '{print $2}' | grep -qx "$BOT_USER"; then
  say "Service account '$BOT_USER' already exists"
else
  say "Creating service account '$BOT_USER'"
  gitea_cli admin user create --admin --username "$BOT_USER" \
    --password "$BOT_PASSWORD" --email "bot@initpad.local" \
    --must-change-password=false >/dev/null
fi

if [ -z "$(get_env INITPAD_GITEA_TOKEN)" ]; then
  say "Issuing admin access token"
  out=$(gitea_cli admin user generate-access-token --username "$BOT_USER" \
    --token-name "initpad-$(date +%s)" --scopes all 2>&1)
  token=$(printf '%s\n' "$out" | grep -oE '[0-9a-f]{40}' | tail -1)
  [ -n "$token" ] || fail "Could not parse the access token. Output: $out"
  set_env INITPAD_GITEA_TOKEN "$token"
else
  say "Admin access token already configured"
fi

if [ -z "$(get_env INITPAD_RUNNER_TOKEN)" ]; then
  say "Generating CI runner registration token"
  out=$(gitea_cli actions generate-runner-token 2>&1)
  rtoken=$(printf '%s\n' "$out" | grep -E '^[A-Za-z0-9]{30,}$' | tail -1)
  [ -n "$rtoken" ] || fail "Could not parse the runner token. Output: $out"
  set_env INITPAD_RUNNER_TOKEN "$rtoken"
else
  say "Runner token already configured"
fi

# ---- CI action mirrors (ADR-171) ---------------------------------------------
# Workflows name actions briefly (`uses: actions/checkout@<sha>`), and act_runner
# fetched each one from github.com at the start of every job: a DNS or network
# hiccup failed builds on a platform that otherwise runs locally. Keep pull
# mirrors in this Gitea and point act_runner at them. The mirrors are used only
# when every listed repository and every action commit the templates pin is
# present; otherwise jobs keep fetching from github.com as before.
gitea_api() { # <method> <path>, JSON body on stdin; prints the HTTP status
  GITEA_TOKEN=$(get_env INITPAD_GITEA_TOKEN) $COMPOSE exec -T -e GITEA_TOKEN gitea sh -c \
    'curl -sS -o /dev/null -w "%{http_code}" -X "$1" -H "Authorization: token $GITEA_TOKEN" \
       -H "Content-Type: application/json" --data-binary @- "http://127.0.0.1:3000/api/v1$2"' \
    sh "$1" "$2" 2>/dev/null || true
}

ensure_action_mirror() { # <owner/name>
  local owner=${1%%/*} name=${1#*/} status
  status=$(gitea_api GET "/orgs/$owner" </dev/null)
  if [ "$status" = 404 ]; then
    status=$(gitea_api POST /orgs <<EOF
{"username":"$owner","visibility":"public","description":"Mirrors of CI actions used by InitPad workflows"}
EOF
)
    [ "$status" = 201 ] || { warn "Could not create the Gitea organization $owner for CI action mirrors (HTTP $status)."; return 1; }
  elif [ "$status" != 200 ]; then
    warn "Could not look up the Gitea organization $owner (HTTP $status)."
    return 1
  fi
  status=$(gitea_api GET "/repos/$owner/$name" </dev/null)
  [ "$status" = 200 ] && return 0
  [ "$status" = 404 ] || { warn "Could not look up the CI action mirror $owner/$name (HTTP $status)."; return 1; }
  say "Mirroring CI action $owner/$name from github.com"
  status=$(gitea_api POST /repos/migrate <<EOF
{"clone_addr":"https://github.com/$owner/$name.git","repo_owner":"$owner","repo_name":"$name","mirror":true,"private":false,"service":"git","description":"Pull mirror of https://github.com/$owner/$name"}
EOF
)
  [ "$status" = 201 ] || { warn "Could not mirror https://github.com/$owner/$name (HTTP $status)."; return 1; }
}

action_commit_mirrored() { # <owner/name> <sha>
  local i
  [ "$(gitea_api GET "/repos/$1/git/commits/$2" </dev/null)" = 200 ] && return 0
  # A template may pin a commit newer than the last scheduled mirror sync.
  gitea_api POST "/repos/$1/mirror-sync" </dev/null >/dev/null
  for i in $(seq 1 15); do
    sleep 2
    [ "$(gitea_api GET "/repos/$1/git/commits/$2" </dev/null)" = 200 ] && return 0
  done
  return 1
}

mirror_ci_actions() {
  local runner_url entry ref ok=yes
  runner_url=$(get_env INITPAD_GITEA_RUNNER_URL)
  runner_url=${runner_url:-http://host.docker.internal:3001}
  runner_url=${runner_url%/}
  while IFS= read -r entry; do
    case "$entry" in ''|'#'*) continue ;; esac
    if ! printf '%s\n' "$entry" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'; then
      warn "Invalid entry in deploy/runner/actions-mirror: $entry"
      ok=no
      continue
    fi
    ensure_action_mirror "$entry" || ok=no
  done < runner/actions-mirror
  if [ "$ok" = yes ]; then
    for ref in $(grep -rhoE 'uses: *[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+@[0-9a-f]{40}' \
        ../templates/*/files/.gitea/workflows/ 2>/dev/null | sed 's/^uses: *//' | sort -u); do
      entry=${ref%@*}
      if ! grep -qx "$entry" runner/actions-mirror; then
        warn "Template action $entry is not listed in deploy/runner/actions-mirror."
        ok=no
      elif ! action_commit_mirrored "$entry" "${ref#*@}"; then
        warn "The mirror of $entry lacks the pinned commit ${ref#*@}."
        ok=no
      fi
    done
  fi
  if [ "$ok" = yes ]; then
    set_env INITPAD_CI_ACTIONS_MIRROR "$runner_url"
    say "CI jobs fetch their actions from this Gitea"
  else
    set_env INITPAD_CI_ACTIONS_MIRROR ""
    warn "CI jobs keep fetching their actions from github.com. Re-run ./install.sh once github.com is reachable."
  fi
}

say "Preparing CI action mirrors"
mirror_ci_actions
# The runner configuration carries the mirror address; render it again.
./render-runner-config.sh
[ -f .runtime/runner-config.changed ] && runner_config_changed=yes

# ---- 4. platform ------------------------------------------------------------
if grep -qx 'services: {}' "$runtime_override"; then
  say "Building and starting the platform (API, web, release Supervisor) — first build takes a few minutes"
  $COMPOSE up -d --build supervisor api web
else
  say "Starting the installed signed platform release"
  $COMPOSE up -d --no-build supervisor api web
fi
say "Waiting for the platform API"
wait_healthy api 60
say "Waiting for the release Supervisor"
wait_healthy supervisor 60

# ---- 5. SSO — MUST run after the API is up: Gitea validates the discovery
# URL immediately when the auth source is registered or updated. Reconcile an
# existing source as well: its cached authorization/token endpoints contain
# INITPAD_PUBLIC_URL and would otherwise survive a LAN address or domain change.
sso_discovery_url=http://api:3000/api/.well-known/openid-configuration
sso_source_id=$(gitea_cli admin auth list 2>/dev/null | \
  awk '$2=="initpad-sso" {print $1; exit}')
if [ -n "$sso_source_id" ]; then
  case "$sso_source_id" in
    *[!0-9]*) fail "The existing initpad-sso authentication source has an invalid id." ;;
  esac
  say "Reconciling Gitea SSO authentication source"
  gitea_cli admin auth update-oauth --id "$sso_source_id" \
    --name initpad-sso --provider openidConnect \
    --key gitea --secret "$OIDC_SECRET" \
    --auto-discover-url "$sso_discovery_url" >/dev/null
else
  say "Registering the platform as Gitea's OIDC sign-in (SSO)"
  gitea_cli admin auth add-oauth --name initpad-sso --provider openidConnect \
    --key gitea --secret "$OIDC_SECRET" \
    --auto-discover-url "$sso_discovery_url" >/dev/null
fi
# Gitea keeps OAuth provider instances in process memory. Reload after the CLI
# reconciliation so the next login cannot use endpoints cached before a public
# URL change. This preserves the source id and all existing account bindings.
say "Reloading Gitea authentication providers"
$COMPOSE restart gitea >/dev/null
wait_healthy gitea 60

# ---- 6. HTTPS proxy, internal CA trust and runner ---------------------------
# Caddy starts before the CI daemon: with an internal CA the daemon must
# receive the CA certificate when it starts.
if [ -n "${DOMAIN:-}" ]; then
  say "Starting Caddy reverse proxy for https://$DOMAIN"
  # A Caddyfile replaced by git keeps its old inode inside a running container,
  # so recreate Caddy only when the mounted configuration is out of date.
  if [ -n "$($COMPOSE --profile server ps -q caddy 2>/dev/null)" ] &&
    ! $COMPOSE --profile server exec -T caddy cat /etc/caddy/Caddyfile 2>/dev/null | \
      cmp -s - Caddyfile; then
    $COMPOSE --profile server up -d --force-recreate caddy
  else
    $COMPOSE --profile server up -d caddy
  fi
elif [ -n "$($COMPOSE --profile server ps -q caddy 2>/dev/null)" ]; then
  say "Stopping Caddy: no domain is configured any more"
  $COMPOSE --profile server stop caddy >/dev/null
fi

# With "tls internal" every certificate comes from Caddy's local CA. Export
# only its public root certificate (never the key) so that people can trust it,
# and make each Docker daemon that talks to the registry trust it for exactly
# the Git hostname (ADR-161).
CA_FILE=.runtime/tls/initpad-root-ca.crt
INTERNAL_CA=no
ca_changed=no
[ "$(get_env INITPAD_TLS_DIRECTIVE || true)" = "tls internal" ] && [ -n "${DOMAIN:-}" ] && INTERNAL_CA=yes

export_internal_ca() {
  local tmp i
  tmp=$(mktemp)
  for i in $(seq 1 30); do
    if $COMPOSE --profile server exec -T caddy \
        cat /data/caddy/pki/authorities/local/root.crt > "$tmp" 2>/dev/null &&
      grep -q 'BEGIN CERTIFICATE' "$tmp"; then
      break
    fi
    : > "$tmp"
    sleep 2
  done
  [ -s "$tmp" ] || { rm -f "$tmp"; fail "Caddy did not create its internal CA — check: docker compose logs caddy"; }
  if ! cmp -s "$tmp" "$CA_FILE"; then
    mv "$tmp" "$CA_FILE"
    chmod 644 "$CA_FILE"
    ca_changed=yes
  else
    rm -f "$tmp"
  fi
}

trust_ca_in_host_docker() { # <registry host>
  local registry=$1 dir
  if docker info --format '{{.SecurityOptions}}' 2>/dev/null | grep -q rootless; then
    dir=${XDG_CONFIG_HOME:-$HOME/.config}/docker/certs.d/$registry
  else
    dir=/etc/docker/certs.d/$registry
  fi
  cmp -s "$CA_FILE" "$dir/ca.crt" 2>/dev/null && return 0
  say "Letting the host Docker daemon trust the InitPad CA for $registry only ($dir/ca.crt)"
  if mkdir -p "$dir" 2>/dev/null && install -m 644 "$CA_FILE" "$dir/ca.crt" 2>/dev/null; then
    return 0
  fi
  if command -v sudo >/dev/null 2>&1 &&
    sudo mkdir -p "$dir" && sudo install -m 644 "$CA_FILE" "$dir/ca.crt"; then
    return 0
  fi
  fail "Could not write $dir/ca.crt. Run as root:
  mkdir -p '$dir' && install -m 644 '$PWD/$CA_FILE' '$dir/ca.crt'
Then re-run ./install.sh."
}

if [ "$INTERNAL_CA" = yes ]; then
  export_internal_ca
  trust_ca_in_host_docker "$(get_env INITPAD_REGISTRY_HOST)"
elif [ -f "$CA_FILE" ]; then
  rm -f "$CA_FILE"
  ca_changed=yes
fi

rotate_runner_if_address_changed
# The seed holds the job image, so a daemon that is erased after every job does
# not pull and unpack it again for each one (ADR-170). It is rebuilt only when
# deploy/runner/seed-images changes. A failure costs speed, not correctness.
say "Preparing the CI image seed"
$COMPOSE --profile runner run --rm -T runner-seed \
  || warn "The CI image seed could not be built. Every CI job will pull its job image, which adds minutes to each build. Re-run install.sh when Docker Hub or the network is reachable."
say "Starting the isolated CI Docker daemon"
if [ "$ca_changed" = yes ] && [ -n "$($COMPOSE --profile runner ps -q runner-docker 2>/dev/null)" ]; then
  # The daemon copies the CA only when it starts.
  $COMPOSE --profile runner up -d --force-recreate runner-docker
else
  $COMPOSE --profile runner up -d runner-docker
fi
wait_healthy runner-docker 60
# The CI daemon resolves names through Docker, not through this shell.
if [ -n "$(get_env INITPAD_GIT_DOMAIN || true)" ]; then
  ci_git=$(get_env INITPAD_GIT_DOMAIN)
  $COMPOSE --profile runner exec -T runner-docker nslookup "$ci_git" >/dev/null 2>&1 \
    || warn "The CI daemon cannot resolve $ci_git. Builds will fail at 'prepare image' until the name resolves from inside Docker (check the DNS record and the host resolver)."
fi
# CI jobs reach the registry and the platform through the server's own address.
# An active ufw drops that traffic from Docker networks and every build would
# fail at "prepare image" or "notify platform". Allow only the runner network.
if systemctl is-active --quiet ufw 2>/dev/null; then
  runner_net=$(docker network ls --format '{{.Name}}' | grep -E '(^|_)ci-control$' | head -n 1 || true)
  if [ -n "$runner_net" ]; then
    runner_bridge="br-$(docker network inspect "$runner_net" --format '{{printf "%.12s" .Id}}')"
    if sudo ufw allow in on "$runner_bridge" to any port 80,443 proto tcp comment 'InitPad CI runner' >/dev/null; then
      say "ufw: the CI runner network may reach this server on ports 80 and 443"
    else
      warn "ufw is active and the CI runner needs ports 80 and 443 on this server. Run: sudo ufw allow in on $runner_bridge to any port 80,443 proto tcp"
    fi
  fi
fi
say "Starting the CI runner"
if [ "$runner_config_changed" = yes ]; then
  # Bind-mounted config content is not part of Compose's service hash. Recreate
  # only when the rendered file changed so the runner actually reads the new
  # capacity without interrupting jobs on every idempotent installer run.
  $COMPOSE --profile runner up -d --force-recreate act_runner
  rm -f .runtime/runner-config.changed
else
  $COMPOSE --profile runner up -d act_runner
fi

# ---- 7. summary ---------------------------------------------------------------
PUBLIC_URL=$(get_env INITPAD_PUBLIC_URL); PUBLIC_URL=${PUBLIC_URL:-http://localhost:8080}
GITEA_URL=$(get_env INITPAD_GITEA_PUBLIC_URL); GITEA_URL=${GITEA_URL:-http://gitea.localhost:3001}
GH_CID=$(get_env INITPAD_GITHUB_CLIENT_ID)
GH_SEC=$(get_env INITPAD_GITHUB_CLIENT_SECRET)
GH_CB=$(get_env INITPAD_GITHUB_CALLBACK_URL)
GITHUB_ON=no
[ -n "$GH_CID" ] && [ -n "$GH_SEC" ] && [ -n "$GH_CB" ] && GITHUB_ON=yes

echo ""
echo "  ✔ InitPad is running."
echo ""
echo "    Platform   ${PUBLIC_URL}"
echo "    Gitea      ${GITEA_URL}   (admin: ${BOT_USER} / password in deploy/.env)"
echo ""
# The first account becomes the administrator and needs the setup token.
user_count=$($COMPOSE exec -T postgres psql -U initpad -d initpad -tAc \
  'SELECT count(*) FROM "User"' 2>/dev/null | tr -d '[:space:]' || true)
if [ "$user_count" = 0 ]; then
  echo "  Create the administrator account in the web UI with this setup token:"
  echo "    $(get_env INITPAD_BOOTSTRAP_TOKEN)"
else
  echo "  Sign in to the web UI and start your first project."
fi
[ "$GITHUB_ON" = "yes" ] && echo "  GitHub sign-in and account linking are enabled."
if [ "$(get_env INITPAD_REGISTRATION_MODE)" = open ] && [ -n "${DOMAIN:-}" ]; then
  echo ""
  echo "  ⚠ Registration is open: anyone who reaches https://$DOMAIN can sign up"
  echo "    and deploy containers to this host. Set INITPAD_REGISTRATION_MODE="
  echo "    admin-provisioned in deploy/.env unless that is intended."
fi
if [ -n "${DOMAIN:-}" ]; then
  echo ""
  echo "  Ports 8080, 3001 and 8085 stay published for the CI network and local"
  echo "  checks, and Docker bypasses ufw. Block them on the public interface;"
  echo "  see deploy/OPERATIONS.md (Bezpečnost)."
fi
if [ "$INTERNAL_CA" = yes ]; then
  GIT_DOMAIN=$(get_env INITPAD_GIT_DOMAIN || true)
  ca_fingerprint=$(openssl x509 -in "$CA_FILE" -noout -fingerprint -sha256 2>/dev/null | \
    sed 's/^[^=]*=//' || true)
  echo ""
  echo "  HTTPS uses InitPad's own certificate authority. Install it as a trusted"
  echo "  root certificate on every computer that opens InitPad:"
  echo "    Download   http://${DOMAIN}/initpad-ca.crt"
  echo "    File       $PWD/$CA_FILE"
  [ -n "$ca_fingerprint" ] && echo "    SHA-256    $ca_fingerprint"
  echo "  In a Windows domain, distribute it with a GPO: Computer Configuration →"
  echo "  Policies → Windows Settings → Security Settings → Public Key Policies →"
  echo "  Trusted Root Certification Authorities. The command in Manage Agent"
  echo "  installs it on Agent servers for ${GIT_DOMAIN} automatically."
fi
if [ -n "${DOMAIN:-}" ]; then
  echo ""
  report_dns "$DOMAIN" "$(get_env INITPAD_GIT_DOMAIN || true)"
fi
echo "  Re-run ./install.sh anytime — it only fixes what is missing."
echo ""
