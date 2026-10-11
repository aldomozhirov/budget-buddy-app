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
#      data/before-restore-<time>/, so nothing is lost and no stale -wal can
#      be replayed onto the restored file,
#   4. copies the backup in as budget-buddy.sqlite,
#   5. copies back images that the data folder is missing, and
#   6. starts the container and waits for /api/health.
# If a step after the first move fails, the current database is put back.
#
# Settings (environment), for another layout or for tests:
#   BB_DATA_DIR    the mounted data folder          (default: ./data)
#   BB_BACKUP_DIR  the mounted backups folder       (default: ./backups)
#   BB_COMPOSE     the compose command              (default: docker compose)
#   BB_HEALTH_URL  where to wait for the app        (default: http://127.0.0.1:${PORT:-8080}/api/health)
#   BB_VERIFY, BB_STOP, BB_START
#                  shell commands that replace the compose ones for steps 1,
#                  2 and 6; "$BB_FILE" holds the absolute path of the backup.
set -euo pipefail

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
BB_HEALTH_URL="${BB_HEALTH_URL:-http://127.0.0.1:${PORT:-8080}/api/health}"
BB_VERIFY="${BB_VERIFY:-$BB_COMPOSE run --rm --no-deps -T -v \"\$BB_FILE:/restore/in.sqlite:ro\" app node server/dist/verifyBackup.js /restore/in.sqlite}"
BB_STOP="${BB_STOP:-$BB_COMPOSE stop app}"
BB_START="${BB_START:-$BB_COMPOSE up -d app}"

[ -d "$BB_DATA_DIR" ] || die "the data folder $BB_DATA_DIR does not exist. Run this from the install folder, or set BB_DATA_DIR."
DB="$BB_DATA_DIR/budget-buddy.sqlite"

say "1/6 Checking $BB_FILE ..."
eval "$BB_VERIFY" || die "the backup file did not pass the check, so nothing was changed."

say "2/6 Stopping the app ..."
eval "$BB_STOP" || die "the app could not be stopped, so nothing was changed."

ASIDE="$BB_DATA_DIR/before-restore-$(date -u +%Y%m%dT%H%M%SZ)"
STAGED="$BB_DATA_DIR/.restore-incoming.$$"
moved=0
undo=1
put_back() {
  rm -f "$STAGED"
  if [ "$undo" -eq 1 ] && [ "$moved" -eq 1 ]; then
    rm -f "$DB" "$DB-wal" "$DB-shm"
    for suffix in "" -wal -shm; do
      [ -e "$ASIDE/budget-buddy.sqlite$suffix" ] && mv "$ASIDE/budget-buddy.sqlite$suffix" "$DB$suffix"
    done
    rmdir "$ASIDE" 2>/dev/null || true
    say "The current database was put back."
  fi
}
trap 'status=$?; if [ "$status" -ne 0 ] && [ "$undo" -eq 1 ]; then put_back; eval "$BB_START" >/dev/null 2>&1 || true; fi' EXIT

say "3/6 Keeping the current database in $ASIDE ..."
mkdir -p "$ASIDE"
for suffix in "" -wal -shm; do
  if [ -e "$DB$suffix" ]; then
    mv "$DB$suffix" "$ASIDE/budget-buddy.sqlite$suffix"
    moved=1
  fi
done

say "4/6 Copying the backup in ..."
cp "$BB_FILE" "$STAGED"
sync
mv "$STAGED" "$DB"
# The backup is a single file; a -wal or -shm from before would corrupt it.
rm -f "$DB-wal" "$DB-shm"

say "5/6 Copying back missing images ..."
if [ -d "$BB_BACKUP_DIR/images" ]; then
  mkdir -p "$BB_DATA_DIR/images"
  # Files only, and never over one the data folder already has.
  (cd "$BB_BACKUP_DIR/images" && find . -type f -print0) |
    while IFS= read -r -d '' file; do
      if [ ! -e "$BB_DATA_DIR/images/$file" ]; then
        mkdir -p "$(dirname "$BB_DATA_DIR/images/$file")"
        cp "$BB_BACKUP_DIR/images/$file" "$BB_DATA_DIR/images/$file"
      fi
    done
else
  say "    (no images in the backups folder)"
fi

say "6/6 Starting the app ..."
eval "$BB_START" || die "the app did not start."
# From here the restored database stays, even if the app is slow to answer.
undo=0
if command -v curl >/dev/null 2>&1; then
  for _ in $(seq 1 60); do
    if curl -fsS "$BB_HEALTH_URL" >/dev/null 2>&1; then
      say "The app is up: $(curl -fsS "$BB_HEALTH_URL")"
      say "Done. The database it replaced is in $ASIDE."
      exit 0
    fi
    sleep 1
  done
  die "the app did not answer $BB_HEALTH_URL within 60 s. The restored database is in place; look at the container logs. The replaced one is in $ASIDE."
fi
say "Done. Check $BB_HEALTH_URL. The database it replaced is in $ASIDE."
