#!/usr/bin/env bash
# The file steps of scripts/restore.sh (BKP-2), run inside a throwaway app
# container so that they see the folders the way the app does.
#
#   restore-files.sh swap   keep the current database aside, copy the backup in
#                           and copy back the images the data folder lacks
#   restore-files.sh undo   put the database kept aside back
#
# They run in the container, not on the host, because on macOS the container
# sees ./data through a virtual machine's file sharing, which can keep showing
# a file that the host has just replaced. The app then opened the old database
# although the restore had reported success. Files moved from the container
# are seen the same way by the app.
#
# Settings (environment), which restore.sh sets for the compose service:
#   BB_FILES_ASIDE   name of the folder, inside the data folder, that keeps the
#                    replaced files (required)
#   BB_FILES_DATA    the data folder           (default: /data)
#   BB_FILES_BACKUPS the backups folder        (default: /backups)
#   BB_FILES_IN      the backup file to copy in (default: /restore/in.sqlite)
set -euo pipefail

DATA="${BB_FILES_DATA:-/data}"
BACKUPS="${BB_FILES_BACKUPS:-/backups}"
IN="${BB_FILES_IN:-/restore/in.sqlite}"
ASIDE="$DATA/${BB_FILES_ASIDE:?BB_FILES_ASIDE is required}"
DB="$DATA/budget-buddy.sqlite"
STAGED="$DATA/.restore-incoming.$$"

say() { printf '%s\n' "$*"; }

# Puts back whatever was kept aside. Only when something was kept: a data
# folder that had no database is left holding the restored one.
put_back() {
  rm -f "$STAGED"
  local kept=0 suffix
  for suffix in "" -wal -shm; do
    [ -e "$ASIDE/budget-buddy.sqlite$suffix" ] && kept=1
  done
  if [ "$kept" -eq 1 ]; then
    rm -f "$DB" "$DB-wal" "$DB-shm"
    for suffix in "" -wal -shm; do
      [ -e "$ASIDE/budget-buddy.sqlite$suffix" ] && mv "$ASIDE/budget-buddy.sqlite$suffix" "$DB$suffix"
    done
    say "The current database was put back."
  fi
  rmdir "$ASIDE" 2>/dev/null || true
}

case "${1:-}" in
  undo)
    put_back
    exit 0
    ;;
  swap) ;;
  *)
    say "usage: restore-files.sh swap|undo" >&2
    exit 2
    ;;
esac

trap 'status=$?; if [ "$status" -ne 0 ]; then put_back; fi' EXIT

say "3/6 Keeping the current database in $ASIDE ..."
mkdir -p "$ASIDE"
for suffix in "" -wal -shm; do
  if [ -e "$DB$suffix" ]; then
    mv "$DB$suffix" "$ASIDE/budget-buddy.sqlite$suffix"
  fi
done

say "4/6 Copying the backup in ..."
cp "$IN" "$STAGED"
sync
mv "$STAGED" "$DB"
# The backup is a single file; a -wal or -shm from before would corrupt it.
rm -f "$DB-wal" "$DB-shm"

say "5/6 Copying back missing images ..."
if [ -d "$BACKUPS/images" ]; then
  mkdir -p "$DATA/images"
  # Files only, and never over one the data folder already has.
  (cd "$BACKUPS/images" && find . -type f -print0) |
    while IFS= read -r -d '' file; do
      if [ ! -e "$DATA/images/$file" ]; then
        mkdir -p "$(dirname "$DATA/images/$file")"
        cp "$BACKUPS/images/$file" "$DATA/images/$file"
      fi
    done
else
  say "    (no images in the backups folder)"
fi
