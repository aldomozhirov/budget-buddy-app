# Budget Buddy

Instructions for every agent working in this repository.

Product requirements are in `docs/requirements.md`. Read it before writing or building a spec: it records what the owner has already decided, including the main stack choices.

The design spec is in `docs/design-spec.md`. Read it before planning or building anything on screen: it records the layout, behaviour, copy and visual system the owner approved in the prototype. Build styling on `docs/design/html/bb.css`. Its style guide is split by section in `docs/design/styleguide/`: read the index there and only the sections you need, not `docs/design/html/styleguide.html`. The raw prototype files are in `docs/design/prototype/`.

In `docs/design/html/screens/` (HTML and PNG per screen), the HTML is the reference for structure, spacing and copy; take exact values and text from it, never from the picture. Use the PNG for a first look at the layout and for comparing a built screen with the design.

## Stack and commands

Node 24 LTS (`.nvmrc`), pnpm 12, TypeScript 6, Vue 3, Vite 8, Vue Router 4, `vite-plugin-pwa` 2, Fastify 5, `fastify-type-provider-zod` 7, zod 4, `better-sqlite3` 13, Drizzle ORM 0 and `drizzle-kit` 0, `decimal.js` 10, date-fns 4, `@date-fns/tz` 1, `@node-rs/argon2` 2, SimpleWebAuthn 14, `web-push` 3, `fflate` 0, `unicode-case-folding` 1, `lucide-vue-next` 1, Vitest 5, Playwright 1, ESLint 10, `typescript-eslint` 8, `eslint-plugin-vue` 10, and Prettier 3. Exact resolutions are pinned in `pnpm-lock.yaml`; the package manager is pinned to pnpm 12.10.1.

From a fresh clone, run `pnpm install --frozen-lockfile`. Use `pnpm dev` for the Vite web app with `/api` proxied to the reloading Fastify server, `pnpm build` for production assets, `pnpm typecheck` for TypeScript checks, `pnpm lint` for ESLint, `pnpm test` for Vitest in each workspace, `pnpm e2e` for a production build tested by Playwright WebKit on iPhone (390 × 844) and iPad (820 × 1180), and `pnpm format` for Prettier. Vitest and Playwright use the `dot` reporter by default; `pnpm test -- --reporter=verbose` prints successful tests too.

## How the team works

Work is done by Claude Code sessions run by AO (Agent Orchestrator, the `ao` CLI), from Milestone D of spec 1.

- A planning session writes a spec with a task list to `docs/specs/<nn>-<slug>.md`. It does not write application code. Model: Claude Opus 5.5 (`claude-opus-5-5`).
- An orchestrator session coordinates: it spawns one AO worker per spec task, relays decisions and watches progress. It does not implement tasks.
- An AO worker implements one task from the spec, writes its tests, runs the verification commands and opens one pull request against `main`. Model: Claude Sonnet 5.5 (`claude-sonnet-5-5`), the project default.
- AO's native reviewer (`ao review trigger`) gives the independent review of the pull request. Model: Claude Opus 5.5.
- Merging is automatic once two gates pass: the AO reviewer approves (`ao review ls`), and the required GitHub check `verify` (typecheck, lint and tests, `.github/workflows/ci.yml`) passes. The owner can still merge or close any pull request. An AO approval is not a GitHub approval and does not merge by itself.
- Searching code and reading documentation needs no strong model. Where a lookup is done by a separate read-only session rather than by the worker itself, use Claude Haiku 5.5 (`claude-haiku-5-5`).
- The spec file is the shared state. Tick tasks off in it and update it when the design changes.

## Agent tooling

- One worker builds one task. Spawn a new worker for the next task, so context and cost stay small. Name it after the task and give it the spec path and task number:
  `ao spawn --harness claude-code --model claude-sonnet-5-5 --name "task-<n>-<slug>" --prompt "Build task <n> of docs/specs/<nn>-<slug>.md."`
- Tasks run one at a time: Playwright binds the fixed port 4174 (`web/playwright.config.ts`), so two workers cannot run `pnpm e2e` together.
- For a hard task, start the worker on Opus: `--model claude-opus-5-5`.
- A worker may not use the agent runtime's own subagents. There is no separate tester, explorer or reviewer inside a worker session: the worker searches the code, writes the tests and runs typecheck, lint, unit and end-to-end tests itself. The independent check is the AO reviewer, which is a separate session.
- When the pull request is pushed and the local checks pass, the worker runs `ao review trigger --pr <url> --model claude-opus-5-5`. Without `--model` the reviewer uses the project's default worker model (Sonnet). Findings arrive as pull request comments; the worker fixes them, pushes and triggers again for the new commit. An approval adds no comments, so check the verdict with `ao review ls`.
- Only after the AO reviewer approves, the worker runs `gh pr merge --auto --squash <url>`. GitHub then squash-merges the pull request when `verify` passes, and deletes the branch. Never enable auto-merge before that approval.
- Report with `ao report`: `--checkpoint` at milestones, `--needs-input` when blocked on a decision, and `--done --pr-created <url>` when finished.
- Skills in `.opencode/skills/` hold rules that only some tasks need. They are plain Markdown and any agent can read them. Read `design-system` before any markup or styling, `build-a-screen` for a screen task, `money-rules` before code that touches amounts, rates or dates, and `webkit-e2e` before a Playwright test.
- A worker pushes its own session branch with a plain `git push` and opens the pull request against `main`. It never force-pushes, deletes a remote branch, pushes to `main`, or merges around the required check (no `--admin`, no changing branch protection). It does not run `tailscale`, `sudo` or destructive git and Docker commands. This machine is also the deployment host: the live app runs from a separate clone, never from a worker's checkout.
- Playwright's WebKit is installed on this machine (`npx playwright install webkit`; checked on macOS 27 with Playwright 1.63).
- Playwright is the project's test runner (`pnpm e2e`) and needs no MCP server.
- `.opencode/agents/`, `opencode.json` and `scripts/build-tasks` are the earlier OpenCode setup on OpenAI models. They are kept for reference and the AO workflow does not use them.

## Definition of done

A task is done when all of these hold:

1. Its acceptance criteria in the spec are met.
2. Typecheck, lint and tests pass, with the output to show it, and the `verify` check passes on the pull request.
3. The AO reviewer reports no blocking findings.
4. The change is committed with a message naming the task, pushed, and open as a pull request against `main`.

## Conventions

- Money is stored as integer minor units (cents), never as floating point.
- No secrets in the repository; use `.env` and keep `.env.example` current.
- Keep changes limited to the task at hand.

## Code comments

- Document every exported function, type and constant, and every Vue component, with TSDoc (`/** */`). For a component, put a summary above `defineProps` and comment its props, emits and slots. Document an internal helper only when its name does not make its purpose clear.
- One line by default: what it does and why, not how. Use a longer block only for what a caller must know: units, rounding, time zones, edge cases, invariants.
- Add `@param` only when a parameter's meaning or units are not obvious, `@returns` only when the result needs explaining, and `@throws` whenever the code throws. Add `@example` only for parsing and formatting, and check it against the code.
- Use inline `//` comments only for lines that are not obvious, such as workarounds, focus or accessibility handling, and subtle invariants. Never narrate the code.
- Keep comment lines at 80 characters or less, and update comments in the same change as the code they describe. `server/src/app.ts` and `shared/src/money/` show the style.
