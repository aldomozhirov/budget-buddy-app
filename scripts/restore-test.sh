#!/usr/bin/env bash
# Proves that a backup can be restored into a fresh container (BKP-2).
#
#   scripts/restore-test.sh
#
# It builds the image, starts a container on a temporary data folder, makes
# data through the API, lets the nightly backup job run, then starts a second,
# fresh container and restores the backup into it with scripts/restore.sh.
# Finally it compares the API's account list and check-ins in both. Everything
# it makes carries the name prefix bb-restore-test-<random> and is removed at
# the end, also on failure. Exit status 0 means the restore works.
set -euo pipefail

cd "$(dirname "$0")/.."

# Rancher Desktop keeps its binaries out of the default PATH.
if ! command -v docker >/dev/null 2>&1 && [ -x "$HOME/.rd/bin/docker" ]; then
  PATH="$HOME/.rd/bin:$PATH"
fi
command -v docker >/dev/null 2>&1 || { echo "restore-test: docker is not installed or not on PATH." >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "restore-test: node is needed for the API steps." >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "restore-test: curl is needed." >&2; exit 1; }

suffix="$(printf '%04x%04x' "$RANDOM" "$RANDOM")"
prefix="bb-restore-test-$suffix"
image="$prefix"
first="$prefix-a"
second="$prefix-b"
tmp="$(mktemp -d)"
# The container's user (node, uid 1000) must be able to write the folders.
chmod 777 "$tmp"

say() { printf '\n== %s\n' "$*"; }
fail() { printf 'restore-test FAILED: %s\n' "$*" >&2; exit 1; }

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    for name in "$first" "$second"; do
      if docker inspect "$name" >/dev/null 2>&1; then
        echo "--- last log lines of $name" >&2
        docker logs --tail 20 "$name" >&2 2>&1 || true
      fi
    done
  fi
  docker rm -f "$first" "$second" >/dev/null 2>&1 || true
  docker rmi "$image" >/dev/null 2>&1 || true
  # Files made by the container may belong to another user: remove them
  # through a throwaway container of the same image if the plain rm fails.
  rm -rf "$tmp" 2>/dev/null || {
    docker run --rm --user root --entrypoint sh -v "$tmp:/clean" "$image" -c 'rm -rf /clean/* /clean/.[!.]*' >/dev/null 2>&1 || true
    rm -rf "$tmp" 2>/dev/null || true
  }
  docker rmi "$image" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

free_port() {
  node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"
}

wait_healthy() {
  local url="$1"
  for _ in $(seq 1 60); do
    if curl -fsS "$url/api/health" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  fail "$url/api/health did not answer within 60 s"
}

# spending <container> <add|dump>: add (add) or print (dump) rows of the
# spending tables inside a test container. There is no API for them yet, so a
# small script reads the container's database directly. "add" gives the
# restore something in every new table to carry; "dump" prints them as JSON.
spending() {
  docker exec -i -w /app/server "$1" node - "$2" <<'JS'
(async () => {
// The app's own function registration: the unique indexes call unicode_casefold.
const { registerDatabaseFunctions } = await import('/app/server/dist/db/migrate.js');
const Database = require('better-sqlite3');
const db = new Database('/data/budget-buddy.sqlite');
registerDatabaseFunctions(db);
db.pragma('foreign_keys = ON');
if (process.argv[2] === 'add') {
  db.exec(`
    INSERT INTO envelope (name, currency, starting_balance, starting_month,
      topup_from_month, position, created_by, created_at, updated_by, updated_at)
      SELECT 'Trips', 'EUR', 12345, '2026-10', '2026-11', 1, id, 1, id, 1
      FROM member ORDER BY id LIMIT 1;
    INSERT INTO envelope_plan (envelope_id, from_month, monthly_amount, mode, created_by, created_at)
      SELECT e.id, '2026-10', 5000, 'carry_over', e.created_by, 1 FROM envelope e;
    INSERT INTO envelope_topup (envelope_id, month, amount, mode, created_at)
      SELECT id, '2026-11', 5000, 'carry_over', 2 FROM envelope;
    INSERT INTO envelope_adjustment (envelope_id, date, amount, note, created_by, created_at)
      SELECT id, '2026-10-20', -250, 'restore test', created_by, 3 FROM envelope;
    INSERT INTO txn (client_id, kind, date, account_id, amount, member_id,
      merchant, created_by, created_at, updated_by, updated_at)
      SELECT 'restore-test-1', 'expense', '2026-10-21', a.id, -1999, m.id,
        'REWE', m.id, 4, m.id, 4
      FROM account a, member m ORDER BY a.id, m.id LIMIT 1;
    INSERT INTO txn_part (txn_id, position, amount, category_id, envelope_id, envelope_amount)
      SELECT t.id, 1, -1999, (SELECT id FROM category WHERE name = 'Groceries'),
        (SELECT id FROM envelope), -1999 FROM txn t;
    INSERT INTO txn_revision (txn_id, action, changes, changed_by, changed_at)
      SELECT id, 'update', '{"amount":["-1000","-1999"]}', member_id, 5 FROM txn;
    INSERT INTO rule (position, pattern, category_id, created_by, created_at, updated_by, updated_at)
      SELECT 1, 'REWE, EDEKA', (SELECT id FROM category WHERE name = 'Groceries'),
        id, 6, id, 6 FROM member ORDER BY id LIMIT 1;
  `);
} else {
  const tables = ['category', 'envelope', 'envelope_plan', 'envelope_topup',
    'envelope_adjustment', 'txn', 'txn_part', 'txn_revision', 'rule'];
  const out = {};
  for (const table of tables) {
    out[table] = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
  }
  console.log(JSON.stringify(out, null, 1));
}
})();
JS
}

# start_container <name> <folder> <port>
start_container() {
  mkdir -p "$2/data" "$2/backups"
  chmod 777 "$2" "$2/data" "$2/backups"
  docker run -d --name "$1" --label "bb-restore-test=$suffix" \
    -p "127.0.0.1:$3:8080" \
    -e "APP_ORIGIN=http://127.0.0.1:$3" -e RATES_FEED=fixture \
    -v "$2/data:/data" -v "$2/backups:/backups" "$image" >/dev/null
}

port_a="$(free_port)"
port_b="$(free_port)"
[ "$port_a" != "$port_b" ] || port_b="$(free_port)"
url_a="http://127.0.0.1:$port_a"
url_b="http://127.0.0.1:$port_b"

say "Building the image $image"
docker build --platform linux/arm64 -q -t "$image" . >/dev/null
echo "built $image"

say "Starting the first container on $url_a"
start_container "$first" "$tmp/a" "$port_a"
wait_healthy "$url_a"
node scripts/restore-test-api.mjs seed "$url_a"
node scripts/restore-test-api.mjs dump "$url_a" > "$tmp/before.json"
echo "accounts and check-ins before: $(grep -c '"id"' "$tmp/before.json") records with an id"
spending "$first" add
spending "$first" dump > "$tmp/before-spending.json"
echo "spending tables before: $(grep -c '"id"' "$tmp/before-spending.json") rows (starter categories included)"

say "Running the backup job (a restart makes the runner claim the due slot)"
docker restart "$first" >/dev/null
wait_healthy "$url_a"
backup=""
for _ in $(seq 1 60); do
  backup="$(ls "$tmp"/a/backups/daily/budget-buddy-*.sqlite 2>/dev/null | head -n 1 || true)"
  [ -n "$backup" ] && break
  sleep 1
done
[ -n "$backup" ] || fail "no backup file appeared in daily/ within 60 s"
for _ in $(seq 1 30); do
  status_json="$(node scripts/restore-test-api.mjs status "$url_a")"
  case "$status_json" in *'"last":{'*) break ;; esac
  sleep 1
done
echo "backup file: $(basename "$backup") ($(wc -c < "$backup" | tr -d ' ') bytes)"
echo "status: $status_json"
case "$status_json" in *'"last":{'*'"failure":null'*) ;; *) fail "the backup status is not good" ;; esac
ls "$tmp"/a/backups/daily | grep -q '^\.' && fail "a temporary file was left in daily/" || true
echo "export: $(node scripts/restore-test-api.mjs export "$url_a")"
docker stop "$first" >/dev/null

say "Starting the second, fresh container on $url_b and stopping it again"
start_container "$second" "$tmp/b" "$port_b"
wait_healthy "$url_b"
docker stop "$second" >/dev/null
# A stale -wal from before must not be replayed onto the restored file.
printf 'stale write-ahead log' > "$tmp/b/data/budget-buddy.sqlite-wal"
old_checksum="$(shasum "$tmp/b/data/budget-buddy.sqlite" | cut -d' ' -f1)"

verify_in_image="docker run --rm --entrypoint node -v \"\$BB_FILE:/restore/in.sqlite:ro\" $image server/dist/verifyBackup.js /restore/in.sqlite"
# The file steps run in a container too, as they do with compose: the same
# restore-files.sh, with the data and backups folders mounted.
files_in_image() {
  echo "docker run --rm --entrypoint bash -e BB_FILES_ASIDE -v \"$tmp/b/data:/data\" -v \"$tmp/b/backups:/backups\" -v \"\$BB_FILE:/restore/in.sqlite:ro\" -v \"$PWD/scripts/restore-files.sh:/restore/files.sh:ro\" $image /restore/files.sh $1"
}
run_restore() {
  BB_DATA_DIR="$tmp/b/data" BB_BACKUP_DIR="$tmp/b/backups" \
  BB_VERIFY="$verify_in_image" BB_STOP="docker stop $second" \
  BB_FILES="$(files_in_image swap)" BB_UNDO="$(files_in_image undo)" \
  BB_START="docker start $second" BB_HEALTH_URL="$url_b/api/health" \
  scripts/restore.sh "$1"
}

say "restore.sh refuses a file that is not a good backup"
printf 'this is not a database' > "$tmp/not-a-backup.sqlite"
if run_restore "$tmp/not-a-backup.sqlite"; then fail "restore.sh accepted a bad file"; fi
[ "$(shasum "$tmp/b/data/budget-buddy.sqlite" | cut -d' ' -f1)" = "$old_checksum" ] || fail "the refused restore changed the database"
ls "$tmp/b/data" | grep -q '^before-restore-' && fail "the refused restore moved files aside" || true
echo "refused, nothing changed"

say "Restoring $(basename "$backup") into the second container"
run_restore "$backup"
wait_healthy "$url_b"

say "Comparing accounts, check-ins and the spending tables"
node scripts/restore-test-api.mjs dump "$url_b" > "$tmp/after.json"
diff "$tmp/before.json" "$tmp/after.json" || fail "accounts or check-ins differ after the restore"
echo "identical ($(wc -l < "$tmp/after.json" | tr -d ' ') lines)"
spending "$second" dump > "$tmp/after-spending.json"
diff "$tmp/before-spending.json" "$tmp/after-spending.json" || fail "spending tables differ after the restore"
[ "$(grep -c '"kind": "' "$tmp/after-spending.json")" -ge 17 ] || fail "the restored spending tables look empty"
echo "spending tables identical ($(wc -l < "$tmp/after-spending.json" | tr -d ' ') lines)"
aside="$(ls -d "$tmp"/b/data/before-restore-* | head -n 1)"
[ -f "$aside/budget-buddy.sqlite" ] || fail "the replaced database was not kept aside"
[ -f "$aside/budget-buddy.sqlite-wal" ] || fail "the stale -wal was not kept aside"
echo "the replaced database is kept in $(basename "$aside")"

say "restore-test OK"
