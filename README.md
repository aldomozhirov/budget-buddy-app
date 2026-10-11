# Budget Buddy

A family budget and net worth tracker that runs on one Mac mini and is reached
only through Tailscale. Requirements are in `docs/requirements.md`, the plan in
`docs/specs/`, and the commands for developing it in `AGENTS.md`.

Installing and updating the app is described here once `compose.yaml` exists
(task 30 of `docs/specs/01-foundation-and-wealth.md`).

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

Run this on the Mac mini, in the folder that holds `compose.yaml`:

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
6. Starts the app and waits for `/api/health`.

If a step after the move fails, the old database is put back and the app is
started again. When you are happy with the restored data you can delete
`data/before-restore-<time>-<number>/`.

To restore into a fresh install, install the app first, open it once so the
data folder exists, then run the command above. Restoring replaces everything
in the database, including the sessions: a device that signed in after the
backup was taken has to sign in again, with the family password of that time.
Push notifications use keys that live in `data/keys/`, outside the backups; on
a fresh install the devices turn notifications on again in Settings.

If `docker compose` is not how you run the app, set `BB_DATA_DIR`,
`BB_BACKUP_DIR`, `BB_VERIFY`, `BB_STOP` and `BB_START` as the comments at the
top of `scripts/restore.sh` describe.

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
