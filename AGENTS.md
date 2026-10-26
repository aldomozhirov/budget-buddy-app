# Budget Buddy

Instructions for every agent working in this repository.

Product requirements are in `docs/requirements.md`. Read it before writing or building a spec: it records what the owner has already decided, including the main stack choices.

The design spec is in `docs/design-spec.md`. Read it before planning or building anything on screen: it records the layout, behaviour, copy and visual system the owner approved in the prototype. Build styling on `docs/design/html/bb.css`. Its style guide is split by section in `docs/design/styleguide/`: read the index there and only the sections you need, not `docs/design/html/styleguide.html`. The raw prototype files are in `docs/design/prototype/`.

In `docs/design/html/screens/` (HTML and PNG per screen), the HTML is the reference for structure, spacing and copy; take exact values and text from it, never from the picture. Use the PNG for a first look at the layout and for comparing a built screen with the design.

## Stack and commands

Node 24 LTS (`.nvmrc`), pnpm 12, TypeScript 6, Vue 3, Vite 8, Vue Router 4, `vite-plugin-pwa` 2, Fastify 5, `fastify-type-provider-zod` 7, zod 4, `better-sqlite3` 13, Drizzle ORM 0 and `drizzle-kit` 0, `decimal.js` 10, date-fns 4, `@date-fns/tz` 1, `@node-rs/argon2` 2, SimpleWebAuthn 14, `web-push` 3, `fflate` 0, `unicode-case-folding` 1, `lucide-vue-next` 1, Vitest 5, Playwright 1, ESLint 10, `typescript-eslint` 8, `eslint-plugin-vue` 10, `eslint-config-prettier` 10, and Prettier 3. Exact resolutions are pinned in `pnpm-lock.yaml`; the package manager is pinned to pnpm 12.10.1.

From a fresh clone, run `pnpm install --frozen-lockfile`. Copy `.env.example` to `.env`: the one file holds the settings of `pnpm dev` (plain names) and of a container copy of the app (`BB_` names), which never share a value. Use `pnpm dev` for the Vite web app with `/api` proxied to the reloading Fastify server (it builds `shared` first and rebuilds it on change, and the server restarts when `shared/dist` changes), `pnpm build` for production assets, `pnpm typecheck` for TypeScript checks, `pnpm lint` for ESLint (any warning fails it, so `verify` catches new ones; Prettier owns template formatting, so `eslint-config-prettier` turns the conflicting `vue/*` formatting rules off, and `no-unexpected-multiline` is switched back on after it), `pnpm test` for Vitest in each workspace, `pnpm e2e` for a production build tested by Playwright WebKit on iPhone (390 × 844) and iPad (820 × 1180), and `pnpm format` for Prettier. Vitest and Playwright use the `dot` reporter by default; `pnpm test -- --reporter=verbose` prints successful tests too.

## How the team works

Work is done by Claude Code sessions run by AO (Agent Orchestrator, the `ao` CLI), from Milestone D of spec 1.

- A planning session writes a spec to `docs/specs/<nn>-<slug>.md` (goal, decisions, design) and creates its tasks in Backlog.md (next section). It does not write application code. Model: Claude Opus 5.5 (`claude-opus-5-5`).
- An orchestrator session coordinates: it spawns one AO worker per Backlog.md task, relays decisions and watches progress. It does not implement tasks.
- An AO worker implements one Backlog.md task, writes its tests, runs the verification commands and opens one pull request against `main`. Model: Claude Sonnet 5.5 (`claude-sonnet-5-5`), the project default.
- AO's native reviewer (`ao review trigger`) gives the independent review of the pull request. Model: Claude Opus 5.5.
- Merging is automatic once two gates pass: the AO reviewer approves (`ao review ls`), and the required GitHub check `verify` (typecheck, lint and tests, `.github/workflows/ci.yml`) passes. The owner can still merge or close any pull request. An AO approval is not a GitHub approval and does not merge by itself.
- Searching code and reading documentation needs no strong model. Where a lookup is done by a separate read-only session rather than by the worker itself, use Claude Haiku 5.5 (`claude-haiku-5-5`).
- Backlog.md (`backlog/`) is the shared state of the work: what is to do, who is on it, the plan, the notes and what is done. The spec holds the design; update it when the design changes. The task lists in specs 1 and 2 are kept as the record of what was built; their open tasks moved to Backlog.md on 2026-10-26.

## Tasks in Backlog.md

Tasks are Markdown files in `backlog/tasks/`, changed only through the `backlog` CLI (installed globally on this machine), never by hand. Run `backlog instructions overview` once per session. Read output with `--plain`. The repository is public, so a task holds nothing a spec would not.

- Planning: one task per pull request, created with `backlog task create "<title>" -d "<what and why>" --ac "<criterion>" --ac "…" -l spec-<nn> --ref docs/specs/<nn>-<slug>.md --dep TASK-<id>`. Put the refs, files and the model (when a task should start on Opus) in the description, as spec 2 did. A task needing the owner (a trial on the family's devices) is labelled `owner`.
- Finding work: `backlog task list -s "To Do" --plain`; take the lowest-numbered task whose dependencies are Done.
- A worker, at the start: `backlog task edit TASK-<id> -s "In Progress" -a @<worker-name>`, then writes its plan with `--plan` before coding, as the first commit on its branch.
- While building: `--check-ac <n>` as each criterion is shown to hold, `--append-notes` for decisions where the task was silent and for deviations from the design.
- Before review: `-s Done --final-summary "<what was built, how it was verified, what was not>"`, committed in the same pull request, so the task becomes Done when it merges. A task blocked on a decision stays In Progress with a note, and the worker reports `--needs-input`.
- `backlog board` and `backlog browser` show the board; they read the files and change nothing unless used to edit.

## Agent tooling

- One worker builds one task. Spawn a new worker for the next task, so context and cost stay small. Name it after the task and give it the task ID:
  `ao spawn --harness claude-code --model claude-sonnet-5-5 --name "task-<id>-<slug>" --prompt "Build Backlog.md task TASK-<id> (backlog task TASK-<id> --plain)."`
- Tasks run one at a time: Playwright binds the fixed port 4174 (`web/playwright.config.ts`), so two workers cannot run `pnpm e2e` together.
- For a hard task, start the worker on Opus: `--model claude-opus-5-5`.
- A worker may not use the agent runtime's own subagents. There is no separate tester, explorer or reviewer inside a worker session: the worker searches the code, writes the tests and runs typecheck, lint, unit and end-to-end tests itself. The independent check is the AO reviewer, which is a separate session.
- When the pull request is pushed and the local checks pass, the worker runs `ao review trigger --pr <url> --model claude-opus-5-5`. Without `--model` the reviewer uses the project's default worker model (Sonnet). Findings arrive as pull request comments; the worker fixes them, pushes and triggers again for the new commit. An approval adds no comments, so check the verdict with `ao review ls`.
- Only after the AO reviewer approves, the worker runs `gh pr merge --auto --squash <url>`. GitHub then squash-merges the pull request when `verify` passes, and deletes the branch. Never enable auto-merge before that approval.
- Branch protection requires the branch to be up to date with `main`, and GitHub does not update it by itself. When the pull request is behind `main`, the worker runs `git fetch origin && git merge origin/main` (never a rebase, since force-pushing is forbidden), fixes any conflicts, re-runs the local checks, pushes, and runs `ao review trigger` for the new commit. It enables auto-merge again after that approval if GitHub turned it off.
- After the pull request merges into `main`, the worker that owned it updates the owner's local checkout and checks that it runs. Find it with `main=$(git worktree list --porcelain | sed -n '1s/^worktree //p')`, the first entry of `git worktree list`; act only if it is on `main` with a clean working tree (`git -C "$main" branch --show-current`, `git -C "$main" status --porcelain`), otherwise change nothing and report that to the owner. Then run `git -C "$main" pull --ff-only`, `pnpm -C "$main" install --frozen-lockfile` and `pnpm -C "$main" --filter @budget-buddy/shared build` and check that the development server runs (next point).
- To check that the development server runs: if a dev server is running there, request `/api/health` on its port after it reloads. If not, start the server on a spare port (not 3000, 5173 or 4174) with scratch data, request `/api/health`, and stop only that process. `tmp=$(mktemp -d)`, then `(cd "$main/server" && exec env HOST=127.0.0.1 PORT=<spare> RATES_FEED=fixture DATA_DIR="$tmp/data" BACKUP_DIR="$tmp/backup" node --import tsx src/index.ts) &`, so that `$!` is the node process in any shell; `kill $!` stops it. Values set on the command line win over the owner's `.env`, which is why every setting that matters is pinned. The scratch `DATA_DIR` is empty, so the job runner has no family and runs nothing. After `kill $!` and `wait $!`, confirm that the process is gone and that `lsof -nti tcp:<spare>` prints nothing. The answer must have `"status":"ok"` and a `migrationVersion` equal to the number of files in `server/drizzle/*.sql`. Never use the owner's `DATA_DIR`, and never stop or restart the owner's processes: if their running server did not pick the change up, report that they need to restart `pnpm dev`.
- Deployments of the app on this machine are managed outside this repository, and a merge does not deploy anything. Agents do not run `scripts/deploy.sh`, and do not build, start, stop, restart or remove any app container other than their own test containers (below). Never `docker compose down -v`, never delete or move a `data` or `backups` folder, never `docker volume`/`system prune`, no `tailscale`, no `sudo`.
- Never commit, stash, reset or otherwise change files in the owner's checkout beyond that pull, install and build. Do not create or edit its `.env`. Report the result with `ao report`.
- Report with `ao report`: `--checkpoint` at milestones, `--needs-input` when blocked on a decision, and `--done --pr-created <url>` when finished.
- Skills in `.opencode/skills/` hold rules that only some tasks need. They are plain Markdown and any agent can read them. Read `design-system` before any markup or styling, `build-a-screen` for a screen task, `money-rules` before code that touches amounts, rates or dates, and `webkit-e2e` before a Playwright test.
- A worker pushes its own session branch with a plain `git push` and opens the pull request against `main`. It never force-pushes, deletes a remote branch, pushes to `main`, or merges around the required check (no `--admin`, no changing branch protection). It does not run `tailscale`, `sudo` or destructive git and Docker commands. This machine is also the deployment host; the app's deployments are managed outside this repository and never run from a worker's worktree. A worker's own Docker tests (`scripts/restore-test.sh`, a compose trial) use an explicit unique project name (`docker compose -p bb-test-<random>`, or `COMPOSE_PROJECT_NAME`), a free port, temporary settings and folders, and remove only what they created; a worker never stops, rebuilds or touches another project's containers, and never prunes. Docker is Rancher Desktop's, in `~/.rd/bin`.
- Playwright's WebKit is installed on this machine (`npx playwright install webkit`; checked on macOS 27 with Playwright 1.63).
- Playwright is the project's test runner (`pnpm e2e`) and needs no MCP server.
- `.opencode/agents/`, `opencode.json` and `scripts/build-tasks` are the earlier OpenCode setup on OpenAI models. They are kept for reference and the AO workflow does not use them.

## Definition of done

A task is done when all of these hold:

1. Its acceptance criteria in its Backlog.md task are met and ticked, and the task is Done with a final summary.
2. Typecheck, lint and tests pass, with the output to show it, and the `verify` check passes on the pull request.
3. The AO reviewer reports no blocking findings.
4. The change is committed with a message naming the task, pushed, and open as a pull request against `main`.
5. After the merge, the owner's local checkout is updated and shown to run, or the report says why it was not.

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

<!-- BACKLOG.MD GUIDELINES START -->
<!-- backlog.md-instructions-version: 1.55.3 -->
<CRITICAL_INSTRUCTION>

## Backlog.md Workflow

This project uses Backlog.md for task and project management.

**At the beginning of each conversation in this project, run `backlog instructions overview` before answering or taking action. Re-read it only if you have not read it yet in the current conversation.**

Use the overview to decide whether to search, read, create, or update Backlog tasks.

Before task lifecycle actions, read the matching detailed guide:
- `backlog instructions task-creation` before creating or splitting tasks
- `backlog instructions task-execution` before planning, changing status or assignee, adding a plan or implementation notes, or implementing task work
- `backlog instructions task-finalization` before checking acceptance criteria, writing final summaries, or moving tasks to terminal statuses

Use `backlog <command> --help` before running unfamiliar commands. Help shows options, fields, and examples.

Do not edit Backlog task, draft, document, decision, or milestone markdown files directly. Use the `backlog` CLI so metadata, relationships, and history stay consistent.

</CRITICAL_INSTRUCTION>
<!-- BACKLOG.MD GUIDELINES END -->
