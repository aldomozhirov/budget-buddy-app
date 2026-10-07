# Budget Buddy

Instructions for every agent working in this repository.

Product requirements are in `docs/requirements.md`. Read it before writing or building a spec: it records what the owner has already decided, including the main stack choices.

The design spec is in `docs/design-spec.md`. Read it before planning or building anything on screen: it records the layout, behaviour, copy and visual system the owner approved in the prototype. Build styling on `docs/design/html/bb.css`. Its style guide is split by section in `docs/design/styleguide/`: read the index there and only the sections you need, not `docs/design/html/styleguide.html`, and use `docs/design/html/screens/` (HTML and PNG per screen) as the visual reference. The raw prototype files are in `docs/design/prototype/`.

## Stack and commands

The stack is decided: see decision D1 and Design section 1 of `docs/specs/01-foundation-and-wealth.md`. Do not ask the user about it again.

Task 2 of that spec creates the workspace and replaces this paragraph with the major versions and the exact install, dev server, typecheck, lint, unit test and end-to-end test commands. Until then the commands are the ones task 2 names (`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm e2e`).

## How the team works

- `plan` (primary) writes a spec with a task list to `docs/specs/<nn>-<slug>.md`. It does not write application code.
- `build` (primary) implements one task at a time from a spec and delegates:
  - `explore` for finding code and reading documentation (read-only, cheapest model)
  - `tester` for writing tests and running the verification commands
  - `reviewer` for an independent read-only review of the diff
- The spec file is the shared state. Tick tasks off in it and update it when the design changes.

## Agent tooling

- One build session builds one task. Start a new session for the next task, so context and cost stay small.
- `build` and `tester` run on `openai/gpt-6-luna`, `plan` and `reviewer` on `openai/gpt-6.1-sol`, `explore` on Luna at low effort. For a hard task, start build with `--model openai/gpt-6.1-sol#high`.
- `opencode.json` turns on the language servers (`lsp`), which give agents TypeScript, Vue and ESLint diagnostics once the workspace exists.
- Skills in `.opencode/skills/` hold rules that only some tasks need. Load `design-system` before any markup or styling, `build-a-screen` for a screen task, `money-rules` before code that touches amounts, rates or dates, and `webkit-e2e` before a Playwright test.
- The Context7 MCP server gives version-specific library documentation. Only `explore` may use it; ask `explore` for library questions.
- OpenCode's background service keeps the PATH it was started with. After installing a tool, run `opencode service restart`.
- Agents do not push, and `build` cannot run `tailscale`, `sudo` or destructive git and Docker commands. This machine is also the deployment host: the live app runs from a separate clone, never from this checkout.
- Subagent access is controlled with the `task` permission in each agent's frontmatter.
- `websearch` is off unless OpenCode is started with `OPENCODE_ENABLE_EXA=1`; `explore` falls back to fetching official docs.
- Playwright's WebKit is installed on this machine (`npx playwright install webkit`; checked on macOS 27 with Playwright 1.63).
- Playwright is the project's test runner (`pnpm e2e`) and needs no MCP server. The Playwright MCP server in `opencode.json` is disabled; enable it only to let `build` look at the running app.

## Definition of done

A task is done when all of these hold:

1. Its acceptance criteria in the spec are met.
2. Typecheck, lint and tests pass, with the output to show it.
3. The reviewer reports no blocking findings.
4. The change is committed with a message naming the task.

## Conventions

- Money is stored as integer minor units (cents), never as floating point.
- No secrets in the repository; use `.env` and keep `.env.example` current.
- Keep changes limited to the task at hand.
