# Spec 08: Feedback

Status: written by a planning session on 2026-11-04 with the owner's answers of the same day. Requirements FBK-1 to FBK-5 and roadmap entry "Spec 8" in `docs/requirements.md`; design UI-SET-6 in `docs/design-spec.md` section 14. The number keeps it apart from the roadmap's specs 3 to 7; it does not depend on them.

Inputs: `AGENTS.md`, `docs/requirements.md` (FBK, SEC-4 to SEC-9, TXN-7, DEP-2, DEP-3), `docs/design-spec.md` (UI-SET-1, UI-SET-6, UI-NAV-4, section 15), `docs/design/html/screens/` (`Settings`, `SettingsFeedback`, `SettingsFeedbackSent`), `docs/design/prototype/` (`Settings.dc.html`, `SettingsFeedback.dc.html`, `SettingsFeedbackSent.dc.html`), `docs/design/html/bb.css` (`.noteinput-tall`, `.attach-tag`, `.toast`), and spec 2 Design 4 (the outbox), whose sending rules this spec reuses.

## Goal

A member who meets a problem, or has an idea, opens Settings → Help → "Send feedback", picks "Something’s wrong" or "An idea", types what happened, adds a screenshot if they like, and taps Send. The sheet closes with a thank-you toast. The report reaches the server with the app version and commit, the device, the iOS version, Home Screen app or Safari, the screen they came from and who sent it, and never an amount or a name from the family's data. Offline it waits on the phone and sends itself later, exactly once. On the server each report becomes a folder of files that the owner's own tooling picks up; the app keeps no list of reports and sends nothing out.

## Decisions taken with the owner for this spec

| # | Topic | Decision |
|---|---|---|
| D1 | Where reports go (UI-SET-6, "Where it goes") | Decided 2026-11-04. The app does not know about any task board. The server writes each report as files in a feedback folder (FBK-3), and the host decides what reads it. This keeps the public repository free of the owner's private tooling and adds no outbound connection (SEC-8). |
| D2 | Which copies send | Decided 2026-11-04. Every running copy writes reports the same way. A copy has no setting for it; whoever reads a copy's folder knows which copy it is. |

## Defaults to confirm

Chosen by the planning session where the requirements and the design are silent. Use them unless the owner objects.

| # | Item | Default | Needed by |
|---|---|---|---|
| O1 | The feedback folder in a container | Its own mount, `./feedback` beside `./data`, so that the host's tooling can read reports without reaching into the family's data. It is a hand-off, not app state (DEP-2): it is not in the backups or the export, and losing it loses only reports nobody has read. `pnpm dev` defaults to `<DATA_DIR>/feedback`. | 1 |
| O2 | Marking a report read | A reader may add files to a report folder or move the whole folder into `archive/` inside the feedback folder. It must not delete or rename it in place: the server checks `<id>` and `archive/<id>` to refuse a duplicate. | 1 |
| O3 | The screenshot | The device always re-encodes the picked image as JPEG, at most 2048 px on the long side, quality 0.85, lowered step by step if the result is still over 3 MB. This also drops the photo's location and other metadata. | 2 |
| O4 | Length of the text | At most 4000 characters, counted after trimming. | 1 |
| O5 | "The screen open before Settings" (FBK-2) | The path of the route Settings was opened from, as Vue Router keeps it in `history.state.back` (for example `/transactions/412`), or `null`. It can hold ids, never names. | 2 |
| O6 | A locked device (SEC-9) | Feedback is not an exception like `POST /api/transactions` (spec 2, D2). A report written on a locked device waits until someone signs in. | 2 |
| O7 | A refused report | A 4xx answer other than `401 unauthenticated` and `session_locked` deletes the report from the phone, since the design has no place to show it. With O3 the only realistic cause is a picture the server cannot read. | 2 |
| O8 | Sign-out | Sign-out first tries to send waiting reports, like the transaction outbox. Reports still unsent are deleted with it, without their own warning; the existing warning keeps counting only transactions. | 2 |

## Out of scope

- A list of earlier reports, their status, or replies (UI-SET-6).
- Sending anything to a service outside the host (SEC-8). Turning reports into tasks is the host's business, not the app's.
- More than one screenshot, video, or attaching a log.
- An entry point other than Settings, such as shaking the phone.
- Storing reports in the database. The app keeps nothing about a report once its folder is written.

## Design

### 1. Report folder (FBK-3)

`FEEDBACK_DIR` holds one folder per report, named by the report's `clientId` (a UUID):

```
<FEEDBACK_DIR>/
  3f0c…-…/            one report
    report.json
    screenshot.jpg    only when one was attached (.png is allowed too)
  archive/            reports a reader has dealt with (O2)
  .tmp/               the server's work area; readers ignore every name starting with "."
```

`report.json`, version 1:

```json
{
  "version": 1,
  "id": "3f0c…",
  "kind": "problem",
  "text": "What the member typed, trimmed",
  "writtenAt": "2026-11-04T18:12:03.120Z",
  "receivedAt": "2026-11-04T18:20:41.002Z",
  "profile": { "id": 2, "name": "Profile name" },
  "app": { "version": "0.1.0", "commit": "4bc9837…" },
  "device": {
    "type": "iPhone",
    "os": "iOS 26.1",
    "display": "standalone",
    "fromScreen": "/transactions/412",
    "userAgent": "Mozilla/5.0 (iPhone; …)"
  },
  "screenshot": "screenshot.jpg"
}
```

`kind` is `problem` or `idea`. `device.type` is `iPhone`, `iPad` or `other`; `os` is `null` when it cannot be read; `display` is `standalone` (Home Screen app) or `browser`. `screenshot` is `null` without one. `app` comes from the server, never from the request. A later change to this shape raises `version`.

Writing: the server makes `.tmp/<id>-<random>/`, writes the files, then renames that folder to `<id>`. A folder named `<id>` is therefore always complete. If `<id>` or `archive/<id>` exists already, or the rename fails because another request made it first, the report is a duplicate: nothing is written and the answer is 200. A failed write removes its `.tmp` folder.

### 2. Settings and build information

- `FEEDBACK_DIR` (`server/src/config.ts`): optional, default `<DATA_DIR>/feedback`. The server creates it, with `.tmp/`, on the first report, not at start, so a copy whose folder cannot be written still starts and serves everything else.
- `APP_COMMIT`: optional, default `unknown`. The Dockerfile takes it as a build argument and sets it in the runtime image. In `compose.yaml` it is `build.args.APP_COMMIT: ${BB_APP_COMMIT:-unknown}`, so whoever builds the image can pass the commit it is built from. `/api/health` adds `commit` beside `appVersion`.
- `compose.yaml`: the volume `./feedback:/feedback` and `FEEDBACK_DIR: /feedback`. The README's first install creates `feedback/` with `data/` and `backups/` (so the container user owns it), and a new "Feedback" section documents section 1 for whoever reads the folder. `.env.example` documents `FEEDBACK_DIR` and `BB_APP_COMMIT`. `.gitignore` adds `feedback/` and `.feedback/`, so a clone that runs a container stays clean.

### 3. API

`POST /api/feedback`: session with a profile, CSRF like every write, refused from a locked session (O6). Body limit 5 MB on this route only. Schema in `shared/src/api/feedback.ts`:

```ts
{
  clientId: string,                 // UUID
  kind: 'problem' | 'idea',
  text: string,                     // trimmed, 3 to 4000 chars, at least 3 not white space
  writtenAt: string,                // ISO date-time, from the device
  device: {
    type: 'iPhone' | 'iPad' | 'other',
    os: string | null,              // at most 40 chars
    display: 'standalone' | 'browser',
    fromScreen: string | null,      // a path starting with "/", at most 200 chars
    userAgent: string,              // at most 400 chars
  },
  screenshot: { type: 'image/jpeg' | 'image/png', data: string } | null  // base64
}
```

The server decodes the screenshot and checks its first bytes (JPEG `FF D8 FF`, PNG `89 50 4E 47 0D 0A 1A 0A`) against `type`, and that it is at most 3 MB (FBK-5, SEC-4); otherwise 400 `invalid`. It answers 201 `{ id }` for a new report, 200 `{ id }` for a duplicate, and 503 `unavailable` ("Could not save your feedback.") when the folder cannot be written. Logs show the id, the kind and whether there is a screenshot, never the text or the image (SEC-6).

### 4. Feedback outbox on the device (FBK-4)

`web/src/offline/feedbackOutbox.ts`, a new IndexedDB store `feedback` (key `clientId`; `DB_VERSION` 3). An item is the request body of section 3 with the screenshot stored as its base64 string (not a `Blob`, which older Safari stores badly in IndexedDB).

It sends at the same moments as the transaction outbox (spec 2 Design 4: on save, at app start, on `online`, on return to the foreground, and every 30 s while items wait and the page is visible), one item at a time, oldest first. 200 or 201 removes the item. A network failure, a 5xx, `401 unauthenticated` and `session_locked` keep it. Any other 4xx removes it (O7). Sign-out tries to send, then deletes what is left with the rest of the device's data (O8). The server's `clientId` check makes a second send from another tab harmless.

`sendFeedback(body)` saves the item, tries to send it at once with a 10-second limit, and returns `sent` or `saved` for the toast.

### 5. Screen (UI-SET-6)

- `SettingsScreen.vue`: the Help card last, with one `BbRow` "Send feedback", subtitle "Report a problem or suggest an idea", a right chevron. It opens the sheet.
- `web/src/screens/settings/FeedbackSheet.vue`: `BbSheet` titled "Send feedback"; `BbSegmented` "Something’s wrong" / "An idea"; a `textarea.noteinput-tall` with the placeholder of the selected kind; the line "App version, device and screen are sent with it. Never amounts or names." with the round image button "Add a screenshot" (a hidden `<input type="file" accept="image/*">`), which turns into the `.attach-tag` "Screenshot ×" once a picture is picked; and the primary `BbButton` "Send", disabled until the text has 3 characters other than white space. Copy, order and classes come from `docs/design/html/screens/SettingsFeedback.html`.
- The draft (kind, text, screenshot) is kept in memory in the module, so Close and reopen keep it until the app is closed. It is never written to storage.
- Send: the button shows it is busy, `sendFeedback` runs, the sheet closes and clears, and a toast (`.toast`, `role="status"`, 4 seconds) reads "Thanks! Your feedback is sent." (`sent`) or "Saved. It sends itself when you’re back online." (`saved`). Offline, Send stays enabled.
- `web/src/screens/settings/feedbackDetails.ts`: builds `device` from `navigator.userAgent` (`deviceName()` in `web/src/device.ts`, the iOS version from `OS 26_1`), `matchMedia('(display-mode: standalone)')` or `navigator.standalone`, and `history.state.back` as it was when Settings opened (O5). Only these values; nothing from the stores.
- `web/src/screens/settings/screenshot.ts`: `createImageBitmap`, a canvas, `toBlob('image/jpeg', …)` per O3, then base64.

## Tasks

On the board with the label `spec-08`. Each task meets the definition of done in `AGENTS.md`; "E2E" means a Playwright test in `web/e2e/` on WebKit at iPhone and iPad sizes (read the `webkit-e2e` skill first).

1. **Feedback on the server.** Design 1 to 3. Files: `server/src/config.ts`, `server/src/modules/feedback/`, `server/src/modules/health/`, `shared/src/api/feedback.ts`, `server/src/app.ts`, `Dockerfile`, `compose.yaml`, `.env.example`, `.gitignore`, `README.md`, tests. Depends: none.
2. **Feedback outbox on the device.** Design 4 and the helpers of Design 5 (`feedbackDetails.ts`, `screenshot.ts`), with unit tests and no screen. Depends: 1.
3. **Send feedback from Settings.** Design 5: the Help card, the sheet and the toast, with E2E online, offline and with a screenshot. Depends: 2.

## Verification

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm e2e
```

Task 1 also builds the image and runs it with a unique compose project, a temporary folder for `data`, `backups` and `feedback`, and `BB_APP_COMMIT` set. A report sent with `curl` from a signed-in session appears as a complete folder whose `report.json` names that commit. The trial then removes only what it created.

## Change log

- 2026-11-04: written.
