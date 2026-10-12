#!/usr/bin/env bash
# Restores a Budget Buddy backup into this install (BKP-2).
#
#   scripts/restore.sh <backup file>
#
# Run it from the folder that holds compose.yaml, on the Mac mini. It
#   1. refuses a file that fails the integrity check (checked inside the app
#      image, which has the SQL functions the database needs),
#   2. stops the app container,
#   3. moves the current database and its -wal and -shm files into
#      data/before-restore-<time>-<number>/, so nothing is lost and no stale
#      -wal can be replayed onto the restored file,
#   4. copies the backup in as budget-buddy.sqlite,
#   5. copies back images that the data folder is missing, and
#   6. starts the container and waits for /api/health.
# If a step after the first move fails, the current database is put back.
# Steps 3 to 5 run in a throwaway container (scripts/restore-files.sh): the
# app sees ./data through the container engine's virtual machine, and a file
# swapped on the host alone is not always seen there at once.
#
# Settings (environment), for another layout or for tests:
#   BB_DATA_DIR    the mounted data folder          (default: ./data)
#   BB_BACKUP_DIR  the mounted backups folder       (default: ./backups)
#   BB_COMPOSE     the compose command              (default: docker compose)
#   BB_HEALTH_URL  where to wait for the app        (default: the port that
#                  compose published for the app, else BB_HOST_PORT, else 8080)
#   BB_VERIFY, BB_FILES, BB_UNDO, BB_STOP, BB_START
#                  shell commands that replace the compose ones for steps 1,
#                  3 to 5, the undo of those, 2 and 6; "$BB_FILE" holds the
#                  absolute path of the backup and "$BB_FILES_ASIDE" the name
#                  of the folder that keeps the replaced files.
#                  BB_VERIFY must print "ok (migration version N)" when the
#                  file is good, as server/dist/verifyBackup.js does.
set -euo pipefail

# Rancher Desktop keeps its binaries out of the default PATH.
if ! command -v docker >/dev/null 2>&1 && [ -x "$HOME/.rd/bin/docker" ]; then
  PATH="$HOME/.rd/bin:$PATH"
fi

say() { printf '%s\n' "$*"; }
die() { printf 'Restore stopped: %s\n' "$*" >&2; exit 1; }

if [ "$#" -ne 1 ] || [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  [ "$#" -eq 1 ] && exit 0
  exit 2
fi

[ -f "$1" ] || die "$1 is not a file."
[ -r "$1" ] || die "$1 cannot be read."
BB_FILE="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
export BB_FILE

BB_DATA_DIR="${BB_DATA_DIR:-./data}"
BB_BACKUP_DIR="${BB_BACKUP_DIR:-./backups}"
BB_COMPOSE="${BB_COMPOSE:-docker compose}"
BB_FILES_ASIDE="before-restore-$(date -u +%Y%m%dT%H%M%SZ)-$$"
export BB_FILES_ASIDE
files_script="$(cd "$(dirname "$0")" && pwd)/restore-files.sh"
# One throwaway container of the app service, with the backup and the file
# script mounted; the compose file mounts ./data and ./backups into it.
in_app() {
  eval "$BB_COMPOSE run --rm --no-deps -T -e BB_FILES_ASIDE -v \"\$BB_FILE:/restore/in.sqlite:ro\" -v \"\$files_script:/restore/files.sh:ro\" app bash /restore/files.sh $1"
}
BB_VERIFY="${BB_VERIFY:-$BB_COMPOSE run --rm --no-deps -T -v \"\$BB_FILE:/restore/in.sqlite:ro\" app node server/dist/verifyBackup.js /restore/in.sqlite}"
BB_FILES="${BB_FILES:-in_app swap}"
BB_UNDO="${BB_UNDO:-in_app undo}"
BB_STOP="${BB_STOP:-$BB_COMPOSE stop app}"
BB_START="${BB_START:-$BB_COMPOSE up -d app}"

# The address the app answers on: the port compose published, which follows
# BB_HOST_PORT in .env, unless BB_HEALTH_URL says otherwise.
health_url() {
  if [ -n "${BB_HEALTH_URL:-}" ]; then
    printf '%s' "$BB_HEALTH_URL"
    return
  fi
  local published
  published="$(eval "$BB_COMPOSE port app 8080" 2>/dev/null | head -n 1 | sed 's/.*://')"
  printf 'http://127.0.0.1:%s/api/health' "${published:-${BB_HOST_PORT:-8080}}"
}

[ -d "$BB_DATA_DIR" ] || die "the data folder $BB_DATA_DIR does not exist. Run this from the install folder, or set BB_DATA_DIR."

say "1/6 Checking $BB_FILE ..."
verdict="$(eval "$BB_VERIFY")" || die "the backup file did not pass the check, so nothing was changed."
printf '%s\n' "$verdict"
# Not only the exit status: a check that did not run must not pass the file.
case "$verdict" in
  *"ok (migration version "*) ;;
  *) die "the check did not report that the file is good, so nothing was changed." ;;
esac

say "2/6 Stopping the app ..."
eval "$BB_STOP" || die "the app could not be stopped, so nothing was changed."

swapped=0
undo=1
# A failure after the stop puts the old database back (if it was moved) and
# starts the app again, so the install is never left stopped.
trap 'status=$?; if [ "$status" -ne 0 ] && [ "$undo" -eq 1 ]; then if [ "$swapped" -eq 1 ]; then eval "$BB_UNDO" >/dev/null 2>&1 || true; fi; eval "$BB_START" >/dev/null 2>&1 || true; fi' EXIT

eval "$BB_FILES" || die "the files could not be swapped; the current database was kept."
swapped=1

say "6/6 Starting the app ..."
eval "$BB_START" || die "the app did not start."
# From here the restored database stays, even if the app is slow to answer.
undo=0
url="$(health_url)"
if command -v curl >/dev/null 2>&1; then
  for _ in $(seq 1 60); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      say "The app is up: $(curl -fsS "$url")"
      say "Done. The database it replaced is in $BB_DATA_DIR/$BB_FILES_ASIDE."
      exit 0
    fi
    sleep 1
  done
  die "the app did not answer $url within 60 s. The restored database is in place; look at the container logs. The replaced one is in $BB_DATA_DIR/$BB_FILES_ASIDE."
fi
say "Done. Check $url. The database it replaced is in $BB_DATA_DIR/$BB_FILES_ASIDE."
