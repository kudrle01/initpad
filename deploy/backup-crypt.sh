#!/usr/bin/env bash
# Encrypts a finished backup directory into one age file, and decrypts it for
# restore.sh (ADR-151). The host encrypts to public recipients only; the
# matching identity (private key) stays off the host.
#
#   ./backup-crypt.sh encrypt <backup-dir> <output.tar.age> <recipients-file>
#   ./backup-crypt.sh decrypt <backup.tar.age> <empty-dir> <identity-file>
set -euo pipefail

fail() { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

command -v age >/dev/null 2>&1 || \
  fail "age is not installed. Install it (Debian/Ubuntu: apt install age) to encrypt backups."

mode=${1:-}
case "$mode" in
  encrypt)
    [ "$#" -eq 4 ] || fail "Usage: $0 encrypt <backup-dir> <output.tar.age> <recipients-file>"
    source_dir=$2 output=$3 recipients=$4
    [ -d "$source_dir" ] || fail "Backup directory '$source_dir' not found."
    [ -s "$recipients" ] || fail "Recipients file '$recipients' is missing or empty."
    [ ! -e "$output" ] || fail "'$output' already exists; choose a new path."
    partial="${output}.partial-$$"
    trap 'rm -f -- "$partial"' EXIT
    # The partial file is private from its first byte and renamed only when
    # complete, so a failed run never leaves a usable-looking backup.
    (umask 077 && tar -C "$source_dir" -cf - . | age -R "$recipients" -o "$partial")
    mv -- "$partial" "$output"
    trap - EXIT
    ;;
  decrypt)
    [ "$#" -eq 4 ] || fail "Usage: $0 decrypt <backup.tar.age> <empty-dir> <identity-file>"
    input=$2 target=$3 identity=$4
    [ -f "$input" ] || fail "Encrypted backup '$input' not found."
    [ -f "$identity" ] || fail "Identity file '$identity' not found."
    [ -d "$target" ] && [ -z "$(ls -A "$target")" ] || fail "'$target' must be an empty directory."
    age -d -i "$identity" "$input" | tar -C "$target" --no-same-owner -xf - || \
      fail "Could not decrypt '$input' with the given identity."
    ;;
  *)
    fail "Usage: $0 encrypt|decrypt ..."
    ;;
esac
