#!/usr/bin/env bash
# Render project templates exactly as InitPad does, build their test and final
# images, then prove that the final non-root workload answers its health route.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
templates=("$@")
if [ "${#templates[@]}" -eq 0 ]; then
  templates=()
  for manifest in "$ROOT"/templates/*/template.json; do
    templates+=("$(basename "$(dirname "$manifest")")")
  done
fi

work=
container=
runtime_image=
test_image=

cleanup() {
  if [ -n "$container" ]; then
    docker rm -f "$container" >/dev/null 2>&1 || true
  fi
  if [ -n "$runtime_image" ]; then
    docker image rm "$runtime_image" >/dev/null 2>&1 || true
  fi
  if [ -n "$test_image" ]; then
    docker image rm "$test_image" >/dev/null 2>&1 || true
  fi
  if [ -n "$work" ]; then
    rm -rf "$work"
  fi
  work=
  container=
  runtime_image=
  test_image=
}
trap cleanup EXIT INT TERM

for template in "${templates[@]}"; do
  source_dir="$ROOT/templates/$template/files"
  manifest="$ROOT/templates/$template/template.json"
  [ -f "$source_dir/Dockerfile" ] || {
    printf 'Unknown or incomplete template: %s\n' "$template" >&2
    exit 1
  }

  printf '\n==> Verifying template image: %s\n' "$template"
  work=$(mktemp -d)
  cp -R "$source_dir"/. "$work"/
  find "$work" -type f -name '*.hbs' -exec sh -c '
    for file do
      rendered=${file%.hbs}
      sed -e "s/{{projectName}}/acceptance-project/g" \
          -e "s/{{year}}/2026/g" "$file" > "$rendered"
      rm "$file"
    done
  ' sh {} +

  runtime_image="initpad-template-${template}:acceptance"
  test_image="initpad-template-${template}:test"
  container="initpad-template-${template}-$$"

  if grep -Eq '^FROM[[:space:]].+[[:space:]]AS[[:space:]]test([[:space:]]|$)' "$work/Dockerfile"; then
    docker build --pull --target test -t "$test_image" "$work"
  fi
  docker build --pull -t "$runtime_image" "$work"

  configured_user=$(docker image inspect --format '{{.Config.User}}' "$runtime_image")
  case "$configured_user" in
    '' | 0 | root | 0:*)
      printf 'Template %s final image runs as root\n' "$template" >&2
      exit 1
      ;;
  esac

  port=$(node -e 'process.stdout.write(String(require(process.argv[1]).port))' "$manifest")
  health_path=$(node -e 'process.stdout.write(require(process.argv[1]).healthPath)' "$manifest")
  docker run -d --name "$container" -p "127.0.0.1::${port}" "$runtime_image" >/dev/null
  published=$(docker port "$container" "${port}/tcp" | tail -n 1)
  host_port=${published##*:}

  healthy=0
  for _ in $(seq 1 40); do
    status=$(curl -sS --max-time 2 -o /dev/null -w '%{http_code}' \
      "http://127.0.0.1:${host_port}${health_path}" || true)
    case "$status" in
      2??)
        healthy=1
        break
        ;;
    esac
    sleep 1
  done
  if [ "$healthy" -ne 1 ]; then
    printf 'Template %s did not become healthy\n' "$template" >&2
    docker logs "$container" >&2 || true
    exit 1
  fi

  printf '    health=%s user=%s\n' "$status" "$configured_user"
  cleanup
done

trap - EXIT INT TERM
printf '\nAll %s template images passed.\n' "${#templates[@]}"
