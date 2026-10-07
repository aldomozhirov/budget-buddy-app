---
name: webkit-e2e
description: How end-to-end tests are written and run in Budget Buddy (Playwright on WebKit at iPhone and iPad sizes), including screenshots for design review. Load before writing or running a Playwright test.
---
# End-to-end tests

Safari is the target, so end-to-end tests run only in WebKit (QUA-2). The exact commands are in `AGENTS.md` once task 2 of spec 01 is done; `web/playwright.config.ts` is the authority for anything below.

## Setup

- Tests live in `web/e2e/`. Run them with `pnpm e2e`.
- Two projects: `iphone` at 390 × 844 and `ipad` at 820 × 1180. Every test runs in both unless it says why not.
- The run builds the app and starts the server against a temporary `DATA_DIR` with `RATES_FEED=fixture`. Tests never reach a real feed and never touch `data/`.
- Seed data through the API, not by writing to the database.

## Writing tests

- One test per acceptance criterion, plus one failure or edge case.
- Find elements by role and accessible name, the way a member would. No CSS class selectors.
- Assert the exact copy from the design spec, including typographic quotes and U+2212 minus.
- Control time with Playwright's clock (`page.clock`); never wait for real seconds.
- Two members means two browser contexts.
- With `reducedMotion: 'reduce'`, no transition may run.
- No request may leave the app's origin (SEC-7). Fail the test if one does.

## Screenshots

- Baselines for visual tests are committed and are specific to macOS WebKit. Update them only when the design changed, and say so in the report.
- For a task that builds or changes a screen, also save a plain screenshot at the `iphone` size to `test-results/screens/<Screen>.png`, where `<Screen>` is the name used in `docs/design/html/screens/`. The reviewer compares it with the design. The folder is git-ignored.

## Output

Keep the output short: run the one spec file while writing (`pnpm e2e -- <file>`), then the full run once. Quote only failing lines.
