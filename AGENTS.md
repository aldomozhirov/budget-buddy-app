# Budget Buddy

Instructions for every agent working in this repository.

Product requirements are in `docs/requirements.md`. Read it before writing or building a spec: it records what the owner has already decided, including the main stack choices.

The design spec is in `docs/design-spec.md`. Read it before planning or building anything on screen: it records the layout, behaviour, copy and visual system the owner approved in the prototype. Build styling on `docs/design/html/bb.css`. Its style guide is split by section in `docs/design/styleguide/`: read the index there and only the sections you need, not `docs/design/html/styleguide.html`. The raw prototype files are in `docs/design/prototype/`.

In `docs/design/html/screens/` (HTML and PNG per screen), the HTML is the reference for structure, spacing and copy; take exact values and text from it, never from the picture. Use the PNG for a first look at the layout and for comparing a built screen with the design.

## Stack and commands

Node 24 LTS (`.nvmrc`), pnpm 12, TypeScript 6, Vue 3, Vite 8, Vue Router 4, `vite-plugin-pwa` 2, Fastify 5, `fastify-type-provider-zod` 7, zod 4, `better-sqlite3` 13, Drizzle ORM 0 and `drizzle-kit` 0, `decimal.js` 10, date-fns 4, `@date-fns/tz` 1, `@node-rs/argon2` 2, SimpleWebAuthn 14, `web-push` 3, `fflate` 0, `unicode-case-folding` 1, `lucide-vue-next` 1, Vitest 5, Playwright 1, ESLint 10, `typescript-eslint` 8, `eslint-plugin-vue` 10, and Prettier 3. Exact resolutions are pinned in `pnpm-lock.yaml`; the package manager is pinned to pnpm 12.10.1.

From a fresh clone, run `pnpm install --frozen-lockfile`. Use `pnpm dev` for the Vite web app with `/api` proxied to the reloading Fastify server, `pnpm build` for production assets, `pnpm typecheck` for TypeScript checks, `pnpm lint` for ESLint, `pnpm test` for Vitest in each workspace, `pnpm e2e` for a production build tested by Playwright WebKit on iPhone (390 × 844) and iPad (820 × 1180), and `pnpm format` for Prettier. Vitest and Playwright use the `dot` reporter by default; `pnpm test -- --reporter=verbose` prints successful tests too.

## How the team works

- `plan` (primary) writes a spec with a task list to `docs/specs/<nn>-<slug>.md`. It does not write application code.
- `build` (primary) implements one task at a time from a spec and delegates:
  - `explore` for finding code and reading documentation (read-only, cheapest model)
  - `tester` for writing tests and running the verification commands
  - `reviewer` for an independent read-only review of the diff
- The spec file is the shared state. Tick tasks off in it and update it when the design changes.

## Agent tooling

- One build session builds one task. Start a new session for the next task, so context and cost stay small.
- `scripts/build-tasks 6-9` (or a milestone letter, `scripts/build-tasks B`) runs one build session per task unattended, in spec order, and checks that each task ends ticked, committed and pushed. A task whose session ends unfinished gets a new session that continues from the working tree, up to three sessions per task (`--attempts`); then the run stops. `--dry-run` shows the plan.
- `build` and `tester` run on `openai/gpt-6-luna`, `plan` and `reviewer` on `openai/gpt-6.1-sol`, `explore` on Luna at low effort. For a hard task, start build with `--model openai/gpt-6.1-sol#high`.
- `opencode.json` turns on the language servers (`lsp`), which give agents TypeScript, Vue and ESLint diagnostics once the workspace exists.
- Skills in `.opencode/skills/` hold rules that only some tasks need. Load `design-system` before any markup or styling, `build-a-screen` for a screen task, `money-rules` before code that touches amounts, rates or dates, and `webkit-e2e` before a Playwright test.
- The Context7 MCP server gives version-specific library documentation. Only `explore` may use it; ask `explore` for library questions.
- OpenCode's background service keeps the PATH it was started with. After installing a tool, run `opencode service restart`.
- `build` pushes each finished task to the remote with a plain `git push`; force pushes and remote branch deletion are denied, and the other agents cannot push. `build` cannot run `tailscale`, `sudo` or destructive git and Docker commands. This machine is also the deployment host: the live app runs from a separate clone, never from this checkout.
- Subagent access is controlled with the `task` permission in each agent's frontmatter.
- `websearch` is off unless OpenCode is started with `OPENCODE_ENABLE_EXA=1`; `explore` falls back to fetching official docs.
- Playwright's WebKit is installed on this machine (`npx playwright install webkit`; checked on macOS 27 with Playwright 1.63).
- Playwright is the project's test runner (`pnpm e2e`) and needs no MCP server. The Playwright MCP server in `opencode.json` is disabled; enable it only to let `build` look at the running app.

## Definition of done

A task is done when all of these hold:

1. Its acceptance criteria in the spec are met.
2. Typecheck, lint and tests pass, with the output to show it.
3. The reviewer reports no blocking findings.
4. The change is committed with a message naming the task, and pushed.

## Conventions

- Money is stored as integer minor units (cents), never as floating point.
- No secrets in the repository; use `.env` and keep `.env.example` current.
- Keep changes limited to the task at hand.
