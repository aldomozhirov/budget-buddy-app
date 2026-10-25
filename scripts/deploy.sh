#!/usr/bin/env bash
# Rebuilds and restarts the family's container from this checkout.
#
#   scripts/deploy.sh
#
# Run it by hand in the checkout the app runs from, once it is on the commit
# you want (README.md, "Update"). It
#   1. skips, changing nothing, when the container settings (BB_APP_ORIGIN in
#      .env) are absent or when no container of this compose project exists:
#      it never creates the family's deployment,
#   2. builds the image (`docker compose build`); a failed build leaves the
#      running container as it is,
#   3. replaces the container (`docker compose up -d`), and
#   4. waits for /api/health on the published port to answer "ok" with a
#      migrationVersion equal to the number of server/drizzle/*.sql files.
# The app copies the database to backups/pre_migration-<time>.sqlite itself
# before it applies a migration, so a merge that carries one is backed up
# first; the script lists the copy it finds. It never rolls back, restores or
# deletes data, and never runs `docker compose down`.
#
# Exit status (the last line printed starts with "deploy:"):
#    0  deployed and healthy
#   10  skipped: no container settings, or no container of this project
#   11  the build failed; the running container was not touched
#   12  the new container did not become healthy (last log lines printed)
#   13  could not run: Docker is not reachable or the settings are invalid
#
# Settings (environment): BB_DEPLOY_TIMEOUT is how many seconds to wait for
# health (default 90). COMPOSE_PROJECT_NAME picks another compose project, for
# tests.
set -uo pipefail

cd "$(dirname "$0")/.."

# Rancher Desktop keeps its binaries out of the default PATH.
if ! command -v docker >/dev/null 2>&1 && [ -x "$HOME/.rd/bin/docker" ]; then
  PATH="$HOME/.rd/bin:$PATH"
fi

say() { printf '%s\n' "$*"; }
finish() {
  code="$1"
  shift
  say "deploy: $*"
  exit "$code"
}

# The value compose will use: the shell wins over .env, as it does for compose.
origin="${BB_APP_ORIGIN:-}"
if [ -z "$origin" ] && [ -f .env ]; then
  origin="$(sed -n 's/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}BB_APP_ORIGIN=//p' .env | tail -n 1 | sed "s/[[:space:]]*#.*//; s/^[\"']//; s/[\"']\$//")"
fi
[ -n "$origin" ] ||
  finish 10 "SKIPPED. BB_APP_ORIGIN is not set in .env, so this checkout has no container settings. Nothing was built or started."
case "$origin" in
  https://*) ;;
  *) finish 13 "NOT RUN. BB_APP_ORIGIN must be the https address of the app, not $origin. Nothing was changed." ;;
esac

command -v docker >/dev/null 2>&1 ||
  finish 13 "NOT RUN. docker is not on PATH (Rancher Desktop puts it in ~/.rd/bin). Nothing was changed."
docker info >/dev/null 2>&1 ||
  finish 13 "NOT RUN. Docker does not answer; is Rancher Desktop running? Nothing was changed."

existing="$(docker compose ps -a -q 2>/dev/null)" ||
  finish 13 "NOT RUN. 'docker compose ps' failed. Nothing was changed."
[ -n "$existing" ] ||
  finish 10 "SKIPPED. No container of this compose project exists, so there is no deployment to update. The family's deployment is never created by this script."

expected="$(find server/drizzle -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')"
say "Container of this project found. Migrations in the code: $expected."
before="$(ls backups 2>/dev/null | grep -c '^pre_migration-' || true)"

log="$(mktemp)"
trap 'rm -f "$log"' EXIT

say "Building the image ..."
if ! docker compose build >"$log" 2>&1; then
  tail -n 30 "$log"
  finish 11 "BUILD FAILED. The running container was not touched."
fi
say "Built."

say "Replacing the container ..."
if ! docker compose up -d >"$log" 2>&1; then
  tail -n 30 "$log"
  docker compose logs --tail 30 app 2>&1
  finish 12 "UNHEALTHY. 'docker compose up -d' failed. Data was not touched and nothing was rolled back."
fi

# The address compose published, so BB_HOST_PORT is followed.
published="$(docker compose port app 8080 2>/dev/null | head -n 1 | sed 's/.*://')"
url="http://127.0.0.1:${published:-${BB_HOST_PORT:-8080}}/api/health"
timeout="${BB_DEPLOY_TIMEOUT:-90}"
answer=""
for _ in $(seq 1 "$timeout"); do
  answer="$(curl -fsS -m 3 "$url" 2>/dev/null || true)"
  version="$(printf '%s' "$answer" | sed -n 's/.*"migrationVersion":\([0-9]*\).*/\1/p')"
  case "$answer" in
    *'"status":"ok"'*)
      if [ "$version" = "$expected" ]; then
        after="$(ls backups 2>/dev/null | grep -c '^pre_migration-' || true)"
        say "Health: $answer"
        if [ "$after" -gt "$before" ]; then
          say "A migration was applied; the copy taken before it: backups/$(ls backups | grep '^pre_migration-' | sort | tail -n 1)"
        fi
        finish 0 "DEPLOYED. $url answers ok, migrationVersion $version equals the $expected migration files."
      fi
      ;;
  esac
  sleep 1
done

say "Last answer from $url: ${answer:-none}"
say "Last log lines of the app:"
docker compose logs --tail 30 app 2>&1
finish 12 "UNHEALTHY. $url did not answer ok with migrationVersion $expected within ${timeout}s. Data was not touched and nothing was rolled back."
