# Budget Buddy

A family budget and net worth tracker that runs on one Mac mini and is reached
only through Tailscale. Requirements are in `docs/requirements.md`, the plan in
`docs/specs/`, and the commands for developing it in `AGENTS.md`.

This file is for the person who runs it on the Mac mini. Commands marked
**not run** were written without access to Tailscale and have not been tried;
every other command here was run as it is shown.

- [One folder, two sets of settings](#one-folder-two-sets-of-settings)
- [Requirements](#requirements)
- [Host preparation](#host-preparation)
- [First install](#first-install)
- [Tailscale Serve](#tailscale-serve)
- [Add it to the iPhone Home Screen](#add-it-to-the-iphone-home-screen)
- [Update](#update)
- [Restore](#restore)
- [Reset the family password](#reset-the-family-password)
- [Settings](#settings)
- [Day to day and troubleshooting](#day-to-day-and-troubleshooting)

## One folder, two sets of settings

> **The family's data is in `./data` and `./backups` of this folder.** Nothing
> else holds it except the copies you make elsewhere. In this folder, never
> run `docker compose down -v`, `git clean -x` (or `-fdx`: it deletes ignored
> files, and both folders are ignored), `rm -rf data backups`, or
> `docker compose -p <another name> up`, which would start a second container
> on the same data. Do not point `pnpm dev` at them (`DATA_DIR`). Tests that
> start containers use their own project name, a free port and temporary
> folders in a different place, as `scripts/restore-test.sh` does.

Two things run from the same checkout and the same `.env`:

|                   | `pnpm dev` (development)                                                                                                     | `docker compose` (the family's app)                                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reads from `.env` | the plain names: `APP_ORIGIN`, `HOST`, `PORT`, `DATA_DIR`, `BACKUP_DIR`, `RATES_FEED`, `VAPID_SUBJECT`, `PUSH_ALLOWED_HOSTS` | only the names that start with `BB_`: `BB_APP_ORIGIN`, `BB_UID`, `BB_GID`, `BB_HOST_PORT`, `BB_RATES_FEED`, `BB_VAPID_SUBJECT`, `BB_PUSH_ALLOWED_HOSTS` |
| Address           | `http://127.0.0.1:5173` (the web app), API on port 3000                                                                      | `https://<host>.<tailnet>.ts.net` through Tailscale Serve, forwarded from `127.0.0.1:8080`                                                              |
| Data              | `.data` and `.backups`                                                                                                       | `./data` and `./backups`                                                                                                                                |
| Rates             | made-up (fixture)                                                                                                            | the real feeds                                                                                                                                          |

`compose.yaml` fixes the container's own `HOST`, `PORT`, `DATA_DIR` and
`BACKUP_DIR`, and takes its address from `BB_APP_ORIGIN` only, so the
development address can never reach the container and the container's address
can never reach `pnpm dev`. Without `BB_APP_ORIGIN`, any `docker compose`
command stops with "BB_APP_ORIGIN is not set" and no container is started.
A merge to `main` does not update a running container; see [Update](#update).

## Requirements

- A Mac mini with Apple silicon. The image is built for `linux/arm64`, which
  is what Docker builds there.
- Rancher Desktop with the `moby` container engine, running. It puts
  `docker` and `docker compose` in `~/.rd/bin`; make sure that folder is on
  your `PATH`.
- Git, to fetch and update the code, and `curl`.
- Tailscale on the Mac mini and on every phone and tablet of the family.
- The development checkout of this repository on the Mac mini
  (`/Users/aldom/Projects/budget-buddy-app`). The family's app runs from this
  same folder, next to `pnpm dev`, and every command below is run in it. There
  is no second clone.

The app has no other dependency. The Node version, the packages and the build
are all inside the image, which is built from `Dockerfile`.

## Host preparation

From `docs/requirements.md` section 10.3. The Mac mini never sleeps and
restarts after a power failure, and automatic login is on (done on
2026-10-05; FileVault is off as a result, so anyone with physical access to
the Mac can read the data). Still to do, by the owner:

1. Make Rancher Desktop start at login (Rancher Desktop → Preferences →
   Application → Behavior), so the app comes back after a restart with nobody
   at the keyboard. The container itself restarts by itself
   (`restart: unless-stopped`).
2. Make LM Studio, with its local server, start at login. The app does not
   use it yet (a later spec does).
3. In the Tailscale admin console, enable MagicDNS and HTTPS certificates for
   the tailnet. Tailscale publishes the machine's host name in public
   certificate logs, so give the Mac mini a neutral name first.
4. Install Tailscale on every family phone and tablet and join them to the
   same tailnet.

## First install

Run these in the development checkout (the folder with `compose.yaml`).

1. Copy the settings and fill in the address:

   ```sh
   cp .env.example .env
   ```

   If you already have a `.env` for `pnpm dev`, keep it and only add the lines
   below: its plain names are `pnpm dev`'s and are not read by the container.
   Open `.env`, remove the `#` before `BB_APP_ORIGIN` and set it to the https
   address Tailscale Serve will give the app,
   `https://<host>.<tailnet>.ts.net` (the Mac mini's name and the tailnet's
   name, shown in the Tailscale menu; no path, no port). Never the
   development address `APP_ORIGIN=http://127.0.0.1:5173`. Leave
   `BB_HOST_PORT` commented out unless 8080 is taken. The
   address matters: the app only accepts changes sent from it, Face ID is tied
   to it, and the push services see it as the contact. If it changes later,
   see [Settings](#settings).

2. Tell the container which user owns the data folders, so it can write them
   and you can still move and delete what it makes:

   ```sh
   printf 'BB_UID=%s\nBB_GID=%s\n' "$(id -u)" "$(id -g)" >> .env
   ```

3. Make the two folders that hold everything the app keeps, as yourself.
   Docker would otherwise create them as root:

   ```sh
   mkdir data backups
   ```

4. Build the image and start the app:

   ```sh
   docker compose build
   docker compose up -d
   ```

   The first build takes a few minutes. Later ones reuse what has not changed.

5. Check that it answers (it should within a few seconds; `docker compose ps`
   then shows `healthy` after the first health check):

   ```sh
   curl -fsS http://127.0.0.1:8080/api/health
   ```

   The answer is `{"status":"ok","migrationVersion":...,"appVersion":...}`.

The app now runs, but only on the Mac mini itself: the port is bound to
`127.0.0.1` (requirements DEP-6). To see that it is not reachable from the
network, ask for it by the Mac's address on the local network; the request
must be refused:

```sh
curl -sS -m 5 "http://$(ipconfig getifaddr en0):8080/api/health"
```

(`en0` is Wi-Fi on a Mac mini; use `en1` for Ethernet on some models.) Keep it
that way: never change the port line in `compose.yaml` to `8080:8080` or
`0.0.0.0:8080:8080`, which would publish the app to the whole network.

Everything the app keeps is in the two folders: `data/` (the database, the
images and the keys it makes) and `backups/`. The container can be deleted and
recreated without losing anything (`docker compose down`, never with `-v`, and
`docker compose up -d`). Both folders are ignored by Git, so `git pull` and
`git checkout` leave them alone; keep them out of any other synced folder too.

## Tailscale Serve

Tailscale Serve gives the app its https address inside the tailnet and
forwards it to the port on `127.0.0.1`. Tailscale Funnel, which opens an
address to the whole internet, is not used and must stay off.

**Not run** (needs Tailscale on the Mac mini and the owner; the result goes
into the spec's "Trial results"):

1. Check that Tailscale on the Mac mini is signed in and connected, and that
   MagicDNS and HTTPS certificates are on (see Host preparation).
2. Start Serve in the background, forwarding to the app:

   ```sh
   tailscale serve --bg 127.0.0.1:8080
   ```

   If your Tailscale version rejects that form, `tailscale serve --help`
   shows the current one; the target is always `http://127.0.0.1:8080`.
   When Serve asks you to enable HTTPS certificates for the tailnet, agree.

3. See what is being served:

   ```sh
   tailscale serve status
   ```

   It should list one https address, `https://<host>.<tailnet>.ts.net`,
   proxying to `http://127.0.0.1:8080`. That address must equal
   `BB_APP_ORIGIN` in `.env`. If it does not, fix `.env` and run
   `docker compose up -d` again so the app picks it up.

4. Check that Funnel is off:

   ```sh
   tailscale funnel status
   ```

   It must show nothing being served to the internet.

5. On an iPhone with Tailscale on, open `https://<host>.<tailnet>.ts.net` in
   Safari. The first start screen appears. Then, with Tailscale turned off on
   the phone (on the home Wi-Fi), the same address must not open. Both belong
   in the trial record.

To stop serving: `tailscale serve reset` (**not run**).

## Add it to the iPhone Home Screen

Open the app's https address in Safari on the phone, in the tailnet, and:

1. First start: choose the family password (at least 10 characters) and the
   profiles. The next family members just open the address and sign in with
   the password and their profile.
2. Tap the Share button, then **Add to Home Screen**, then **Add**. On an
   iPad it is the same. Open the app from its icon from now on: it runs
   without the browser's bars and works on the Home Screen only.
3. Turn notifications on from the installed app (Settings → This device →
   Notifications), tap the switch, read the explanation and allow them when
   iPhone asks. They **cannot** be turned on in a Safari tab or with
   `pnpm dev`: iOS only allows web push for an app on the Home Screen, and
   the row says "Add Budget Buddy to your Home Screen to turn this on" until
   then. Each device turns them on for itself. Without them everything still
   works; the banner on Home is the reminder.
4. Optional: Settings → Sign-in → **Unlock with Face ID**. It belongs to
   this device and to the address in `BB_APP_ORIGIN`.

## Update

Updates are made by hand, when you decide: a merge to `main` changes nothing
in a running container. In the folder the app runs from, with the checkout on
the commit you want and no uncommitted changes (the image is built from the
working folder):

```sh
git pull --ff-only
scripts/deploy.sh
```

The last line starts with `deploy:` and says what happened: `DEPLOYED`,
`SKIPPED` (nothing is changed), `BUILD FAILED` (the running container was not
touched) or `UNHEALTHY` (with the last log lines). The same two steps by hand
are `docker compose build` and `docker compose up -d`; `up -d` replaces the
container only when the image changed.

The database is migrated when the new version starts, after a copy named
`backups/pre_migration-<time>.sqlite` has been taken and checked, so an
update that carries a migration reaches the family's data with that backup
already in place; a migration that fails stops the start and leaves the data as it was
(`deploy.sh` then prints the container's last log lines and exits with 12).
Nothing rolls back by itself. If the new version is wrong, `git checkout` the
previous version, run `scripts/deploy.sh` again and, if a migration changed the
data, [restore](#restore) the copy that was taken before it.

## Restore

Every night at 03:30 (the family's time zone) the app copies its database to the
backups folder (`BACKUP_DIR`, mounted as `./backups` next to `compose.yaml`):

| Path                                             | Holds                                               |
| ------------------------------------------------ | --------------------------------------------------- |
| `backups/daily/budget-buddy-YYYY-MM-DD.sqlite`   | The last 14 nights.                                 |
| `backups/monthly/budget-buddy-YYYY-MM-DD.sqlite` | The first backup of each month, the last 12.        |
| `backups/images/`                                | Every image the app has stored, never removed.      |
| `backups/pre_migration-<time>.sqlite`            | A copy taken before an update changed the database. |

Each copy is made with SQLite's online backup while the app is running, checked
with `PRAGMA integrity_check`, and only then given its final name, so a file in
`daily/` or `monthly/` is a good one. Settings → Data → Backup shows the last
one, and Home warns when it is more than two days old.

### Restore a backup

Run this on the Mac mini, in the development checkout (the folder that holds
`compose.yaml`):

```sh
scripts/restore.sh backups/daily/budget-buddy-2026-10-10.sqlite
```

It does these steps, and stops at the first that fails:

1. Checks the file inside the app image. A file that is damaged, is not a
   Budget Buddy database or comes from a newer version is refused, and nothing
   is changed.
2. Stops the app.
3. Moves the current database, with its `-wal` and `-shm` files, into
   `data/before-restore-<time>-<number>/`. Nothing is deleted, and an old `-wal` can
   never be replayed onto the restored file.
4. Copies the backup in as `data/budget-buddy.sqlite`.
5. Copies back the images the data folder is missing, without overwriting any.
6. Starts the app and waits for `/api/health` on the port Docker published.

Steps 3 to 5 run in a short-lived container of the app, not on the Mac itself:
the app sees `data/` through Docker's virtual machine, which on a Mac does not
always notice at once that the host swapped a file, and the app could then
start on the old database. Moving the files from inside gives the app and the
script the same view.

If a step after the move fails, the old database is put back and the app is
started again. When you are happy with the restored data you can delete
`data/before-restore-<time>-<number>/`.

To restore into a fresh install, install the app first (the app has to be
running once so `data/` exists), then run the command above. Restoring replaces everything
in the database, including the sessions: a device that signed in after the
backup was taken has to sign in again, with the family password of that time.
Push notifications use keys that live in `data/keys/`, outside the backups; on
a fresh install the devices turn notifications on again in Settings.

It follows `BB_HOST_PORT` for the health check. If `docker compose` is not how
you run the app, set `BB_DATA_DIR`,
`BB_BACKUP_DIR`, `BB_VERIFY`, `BB_FILES`, `BB_UNDO`, `BB_STOP` and `BB_START` as
the comments at the top of `scripts/restore.sh` describe.

### Test the restore

```sh
scripts/restore-test.sh
```

builds the image, starts a container on a temporary folder, makes data through
the API, lets the nightly job run, starts a second container with an empty data
folder, restores the backup into it with `scripts/restore.sh` and compares the
accounts and check-ins of both. It needs Docker, takes about a minute, names
everything it creates `bb-restore-test-<random>` and removes it again, also on
failure. It exits with 0 when the restore works.

### Export

Settings → Data → Export all data downloads one `.zip` of CSV files: members,
accounts, snapshots, snapshot revisions, check-ins, rates, coins and settings.
Amounts are written as exact decimals with a currency column, and times are in
UTC. The export holds no password, session, passkey or notification keys. It is
for reading the data elsewhere, not for restoring: use a backup for that.

## Reset the family password

If nobody is signed in who can change it in Settings → Family password, set a
new one on the Mac mini, in the development checkout:

```sh
docker compose exec app node server/dist/cli.js reset-password
```

It asks for the new password twice, with nothing shown while you type (at
least 10 characters), and never takes it as an argument, so it stays out of the
shell history and the process list. It works while the app is running. It
then:

- sets the new family password and clears a sign-in lockout,
- signs out every device, so each one asks for the new password,
- deletes all Face ID passkeys (each device turns Face ID on again after it
  signs in), and
- deletes all notification subscriptions (each device turns notifications on
  again in Settings).

Profiles, accounts and all the data stay. It prints how many of each it
removed, and nothing else about the password.

## Settings

All settings are in `.env`, next to `compose.yaml`; `.env.example` lists every
one with its meaning. The container reads only the `BB_` names (see
[One folder, two sets of settings](#one-folder-two-sets-of-settings)). After a
change, run `docker compose up -d`.

| Setting                 | Meaning                                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BB_APP_ORIGIN`         | The https address of the app (see First install). The first address is also the Face ID relying party. If it changes, each device turns Face ID off and on again (the password still works). Required. |
| `BB_UID`, `BB_GID`      | The user and group the app runs as, so the folders `data/` and `backups/` stay yours. Set in First install step 2.                                                                                     |
| `BB_HOST_PORT`          | The port on the Mac mini, on `127.0.0.1` only. Default 8080. Tailscale Serve must forward to the same port.                                                                                            |
| `BB_RATES_FEED`         | Left out: the real price feeds (ECB, Bank of Russia, Coinbase). `fixture` gives made-up rates, for trying the app offline.                                                                             |
| `BB_VAPID_SUBJECT`      | Left out: the app's https address is the contact the push service sees. Set a `mailto:` or `https:` URL only if Apple's push service refuses the default.                                              |
| `BB_PUSH_ALLOWED_HOSTS` | Leave at its default, Apple's push service, the only place the app may send a push (requirement SEC-8).                                                                                                |

The plain names in the same file (`APP_ORIGIN`, `PORT`, `DATA_DIR`,
`RATES_FEED` ...) belong to `pnpm dev` and do nothing to the container.

The time zone is not set here. It is a setting in the app (default
Europe/Berlin) and governs "today", the schedule and the nightly backup.

## Day to day and troubleshooting

```sh
docker compose ps
docker compose logs --tail 50 app
docker compose stop
docker compose up -d
```

- **Any `docker compose` command says "BB_APP_ORIGIN is not set".** The
  container settings are missing from `.env` (First install step 1). Nothing
  was started. The plain `APP_ORIGIN` of `pnpm dev` does not count.
- **It does not start and `docker compose logs` says the data (or backups)
  folder "cannot be written by the app".** The folder belongs to someone else
  than `BB_UID`/`BB_GID`. Make the folders as yourself (First install step 3)
  and set both variables (step 2), or change the owner of the folders to the
  user in the message.
- **Port 8080 is in use.** Set `BB_HOST_PORT` in `.env` to a free port, run
  `docker compose up -d`, and give Tailscale Serve the same port.
- **`docker: command not found`.** Rancher Desktop is not running, or
  `~/.rd/bin` is not on the `PATH`.
- **`scripts/deploy.sh` ended with `UNHEALTHY`.** Its output has the container's
  last log lines. Nothing was deleted or rolled back. Fix the cause, or
  `git checkout` the previous version, and run `scripts/deploy.sh` again; to go
  back to older data, [restore](#restore) a backup.
- **`scripts/deploy.sh` ended with `SKIPPED`.** `BB_APP_ORIGIN` is not set in
  `.env`, or this project has no container yet. Follow
  [First install](#first-install); the script never creates the deployment.
- **After a restart of the Mac the app is down.** Rancher Desktop must start
  at login (Host preparation 1); the container then starts by itself.
- **The data.** `data/` holds `budget-buddy.sqlite` and the keys; copy
  `backups/` somewhere else too, since a disk failure takes both.
