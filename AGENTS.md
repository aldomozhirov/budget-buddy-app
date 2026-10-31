# Budget Buddy

Instructions for every agent working in this repository.

Product requirements are in `docs/requirements.md`. Read it before writing or building a spec: it records what the owner has already decided, including the main stack choices.

The design spec is in `docs/design-spec.md`. Read it before planning or building anything on screen: it records the layout, behaviour, copy and visual system the owner approved in the prototype. Build styling on `docs/design/html/bb.css`. Its style guide is split by section in `docs/design/styleguide/`: read the index there and only the sections you need, not `docs/design/html/styleguide.html`. The raw prototype files are in `docs/design/prototype/`.

In `docs/design/html/screens/` (HTML and PNG per screen), the HTML is the reference for structure, spacing and copy; take exact values and text from it, never from the picture. Use the PNG for a first look at the layout and for comparing a built screen with the design.

## Stack and commands

Node 24 LTS (`.nvmrc`), pnpm 12, TypeScript 6, Vue 3, Vite 8, Vue Router 4, `vite-plugin-pwa` 2, Fastify 5, `fastify-type-provider-zod` 7, zod 4, `better-sqlite3` 13, Drizzle ORM 0 and `drizzle-kit` 0, `decimal.js` 10, date-fns 4, `@date-fns/tz` 1, `@node-rs/argon2` 2, SimpleWebAuthn 14, `web-push` 3, `fflate` 0, `unicode-case-folding` 1, `lucide-vue-next` 1, Vitest 5, Playwright 1, ESLint 10, `typescript-eslint` 8, `eslint-plugin-vue` 10, `eslint-config-prettier` 10, and Prettier 3. Exact resolutions are pinned in `pnpm-lock.yaml`; the package manager is pinned to pnpm 12.10.1.

From a fresh clone, run `pnpm install --frozen-lockfile`. Copy `.env.example` to `.env`: the one file holds the settings of `pnpm dev` (plain names) and of a container copy of the app (`BB_` names), which never share a value. Use `pnpm dev` for the Vite web app with `/api` proxied to the reloading Fastify server (it builds `shared` first and rebuilds it on change, and the server restarts when `shared/dist` changes), `pnpm build` for production assets, `pnpm typecheck` for TypeScript checks, `pnpm lint` for ESLint (any warning fails it, so `verify` catches new ones; Prettier owns template formatting, so `eslint-config-prettier` turns the conflicting `vue/*` formatting rules off, and `no-unexpected-multiline` is switched back on after it), `pnpm test` for Vitest in each workspace, `pnpm e2e` for a production build tested by Playwright WebKit on iPhone (390 × 844) and iPad (820 × 1180), and `pnpm format` for Prettier. Vitest and Playwright use the `dot` reporter by default; `pnpm test -- --reporter=verbose` prints successful tests too.

## How the team works

Work is done by coding-agent sessions that the owner starts with one of the role agents below. Agent Orchestrator (AO) is no longer used, from 2026-10-31. The project is set up for three agent harnesses: Claude Code (the default), Codex and OpenCode. Each role has a model per harness:

| Role | Claude Code | Codex | OpenCode |
| --- | --- | --- | --- |
| Planning, review | `claude-opus-5-5` | `gpt-6.1-sol` | `openai/gpt-6.1-sol` |
| Build, tests | `claude-sonnet-5-5` | `gpt-6-luna` | `openai/gpt-6-luna` |
| Lookups (explore) | `claude-haiku-5-5` | `gpt-6-luna`, low effort | `openai/gpt-6-luna`, low effort |

- A planning session (`plan`) writes a spec to `docs/specs/<nn>-<slug>.md` (goal, decisions, design) and creates its tasks in Backlog.md (next section). It does not write application code.
- A build session (`build`) implements one Backlog.md task. It hands lookups to `explore`, tests to `tester` and the independent review of its uncommitted diff to `reviewer`, then opens one pull request against `main` and sees it merged.
- Merging is automatic once two gates pass: `reviewer` reports no blocking findings, after which the build session enables auto-merge, and the required GitHub check `verify` (typecheck, lint and tests, `.github/workflows/ci.yml`) passes. The owner can still merge or close any pull request. A `reviewer` verdict is not a GitHub approval.
- Searching code and reading documentation needs no strong model. Lookups go to `explore`, on the lookup model of the table.
- The task board is the shared state of the work: what is to do, who is on it, the plan, the notes and what is done. The spec holds the design; update it when the design changes. The task lists in specs 1 and 2 are kept as the record of what was built; their open tasks moved to the board on 2026-10-26.

## Tasks

Tasks are kept in Backlog.md on a board outside this repository, private to this machine. Reach it only with `bbtask`, which runs the `backlog` CLI on that board from any folder; never look for its files or edit them by hand. Each change is saved on the board at once: nothing about a task is committed, pushed or put in a pull request. Run `bbtask instructions overview` once per session, and read output with `--plain`.

Statuses: To Do, In Progress, In Review, Done.

- Planning: one task per pull request, created with `bbtask task create "<title>" -d "<what and why>" --ac "<criterion>" --ac "…" -l spec-<nn> --ref docs/specs/<nn>-<slug>.md --dep TASK-<id>`. Put the refs, files and the model (when a task should start on Opus) in the description, as spec 2 did. A task needing the owner (a trial on the family's devices) is labelled `owner`.
- Finding work: `bbtask task list -s "To Do" --plain`. Bugs labelled `bug` with priority high come first; otherwise take the lowest-numbered task whose dependencies are Done.
- A build session, at the start: `bbtask task edit TASK-<id> -s "In Progress" -a @<harness>` (`@claude`, `@codex` or `@opencode`), then writes its plan with `--plan` before coding.
- While building: `--check-ac <n>` as each criterion is shown to hold, `--append-notes` for decisions where the task was silent and for deviations from the design.
- When the pull request is open: `-s "In Review"` and `--append-notes "PR: <url>"`. After it merges: `-s Done --final-summary "<what was built, how it was verified, what was not>"`. A pull request that is closed unmerged puts the task back to To Do with a note. A task blocked on a decision stays In Progress with a note, and the session asks the owner.
- The pull request and its commits name the task (`TASK-<id>`) but do not copy its text: the board is private and this repository is public.
- `bbtask board` and `bbtask browser` show the board.

### Bugs

A bug is a task labelled `bug`, titled `Bug: <what goes wrong>`. The owner reports one in `bbtask browser`, with the command below, or by describing it to any session, which then creates it.

`bbtask task create "Bug: <what goes wrong>" -l bug --priority <high|medium|low> -d "<report>"`

- The description has these lines, each left out when unknown: **Where** (screen or path, such as `/transactions`), **Device** (iPhone or iPad, iOS version, Home Screen app or Safari), **Version** (the commit the copy runs, when known), **Steps**, **Expected**, **Actual**, **Since** (date first seen, or the change suspected).
- Priority: **high** when data is wrong or lost, money is shown wrongly, or something can't be done at all; **medium** when a feature is broken but there is a way around it; **low** for looks and copy.
- A report may hold real details, since the board is private. Never copy them into code, tests, fixtures, commits or pull requests: reproduce the bug with made-up values of the same shape (currency, decimals, dates).
- The build session first reproduces the bug in a test that fails, and adds the acceptance criteria if the report has none: "A test reproduces the bug and fails before the fix" and "The test passes after the fix". It records the cause with `--append-notes`. A bug it cannot reproduce stays In Progress with a note of what was tried, and the session asks the owner.
- A bug found while building another task becomes its own `bug` task, unless the fix belongs in the task at hand.

## Agent tooling

- One session builds one task. Start a new session for the next task, so context and cost stay small: `claude --agent build`, then "Build task TASK-<id>". In OpenCode, pick `build` with Tab; in Codex, ask the session to use the build agent. For a hard task, start it on the planning model: `claude --agent build --model claude-opus-5-5`, or `gpt-6.1-sol` on Codex. The rest of this section holds for every harness.
- Tasks run one at a time: Playwright binds the fixed port 4174 (`web/playwright.config.ts`), so two sessions cannot run `pnpm e2e` together.
- `reviewer` reviews the uncommitted diff before the commit. Fix every blocking finding and run `tester` again when code changed.
- Only after `reviewer` reports no blocking findings and the pull request is open, the build session runs `gh pr merge --auto --squash <url>`. GitHub then squash-merges the pull request when `verify` passes, and deletes the branch. Never enable auto-merge before that verdict.
- Branch protection requires the branch to be up to date with `main`, and GitHub does not update it by itself. When the pull request is behind `main`, the build session runs `git fetch origin && git merge origin/main` (never a rebase, since force-pushing is forbidden), fixes any conflicts, re-runs the local checks, asks `reviewer` again if resolving conflicts changed code, and pushes. It enables auto-merge again if GitHub turned it off.
- After the pull request merges into `main`, the build session updates the owner's local checkout and checks that it runs. Find it with `main=$(git worktree list --porcelain | sed -n '1s/^worktree //p')`, the first entry of `git worktree list`; act only if it is on `main` with a clean working tree (`git -C "$main" branch --show-current`, `git -C "$main" status --porcelain`), otherwise change nothing and report that to the owner. Then run `git -C "$main" pull --ff-only`, `pnpm -C "$main" install --frozen-lockfile` and `pnpm -C "$main" --filter @budget-buddy/shared build` and check that the development server runs (next point).
- To check that the development server runs: if a dev server is running there, request `/api/health` on its port after it reloads. If not, start the server on a spare port (not 3000, 5173 or 4174) with scratch data, request `/api/health`, and stop only that process. `tmp=$(mktemp -d)`, then `(cd "$main/server" && exec env HOST=127.0.0.1 PORT=<spare> RATES_FEED=fixture DATA_DIR="$tmp/data" BACKUP_DIR="$tmp/backup" node --import tsx src/index.ts) &`, so that `$!` is the node process in any shell; `kill $!` stops it. Values set on the command line win over the owner's `.env`, which is why every setting that matters is pinned. The scratch `DATA_DIR` is empty, so the job runner has no family and runs nothing. After `kill $!` and `wait $!`, confirm that the process is gone and that `lsof -nti tcp:<spare>` prints nothing. The answer must have `"status":"ok"` and a `migrationVersion` equal to the number of files in `server/drizzle/*.sql`. Never use the owner's `DATA_DIR`, and never stop or restart the owner's processes: if their running server did not pick the change up, report that they need to restart `pnpm dev`.
- Deployments of the app on this machine are managed outside this repository, and a merge does not deploy anything. Agents do not run `scripts/deploy.sh`, and do not build, start, stop, restart or remove any app container other than their own test containers (below). Never `docker compose down -v`, never delete or move a `data` or `backups` folder, never `docker volume`/`system prune`, no `tailscale`, no `sudo`.
- Never commit, stash, reset or otherwise change files in the owner's checkout beyond that pull, install and build. Do not create or edit its `.env`.
- A build session reports in its last message: the pull request, the verification output, and whether the owner's checkout was updated. A task blocked on a decision stays In Progress with a note, and the session asks the owner.
- Skills in `.agents/skills/` hold rules that only some tasks need. Codex and OpenCode find them there, and Claude Code through the links in `.claude/skills/`; they are plain Markdown, so any agent can also read them. Read `design-system` before any markup or styling, `build-a-screen` for a screen task, `money-rules` before code that touches amounts, rates or dates, and `webkit-e2e` before a Playwright test.
- A build session pushes its own branch with a plain `git push` and opens the pull request against `main`. It never force-pushes, deletes a remote branch, pushes to `main`, or merges around the required check (no `--admin`, no changing branch protection). It does not run `tailscale`, `sudo` or destructive git and Docker commands. This machine is also the deployment host; the app's deployments are managed outside this repository and never run from a session's worktree. A session's own Docker tests (`scripts/restore-test.sh`, a compose trial) use an explicit unique project name (`docker compose -p bb-test-<random>`, or `COMPOSE_PROJECT_NAME`), a free port, temporary settings and folders, and remove only what they created; a session never stops, rebuilds or touches another project's containers, and never prunes. Docker is Rancher Desktop's, in `~/.rd/bin`.
- Playwright's WebKit is installed on this machine (`npx playwright install webkit`; checked on macOS 27 with Playwright 1.63).
- Playwright is the project's test runner (`pnpm e2e`) and needs no MCP server.
- Five role agents are defined for each harness, with the same instructions: `plan` (a spec and its tasks), `build` (one task, from plan to merge), `explore` (read-only lookups), `tester` and `reviewer`. They are in `.claude/agents/`, `.codex/agents/` and `.opencode/agents/`. Start a planning or build session with `claude --agent plan` or `claude --agent build`, or pick the agent with Tab in OpenCode. In Codex, ask the session to hand the work to the agent ("use the plan agent").
- context7 (library documentation) is set up for `explore` in `.claude/agents/explore.md` and `opencode.json`, and for every Codex session in `.codex/config.toml`.
- The commands above that no agent runs are also blocked by each harness: `permissions.deny` in `.claude/settings.json`, `.codex/rules/guardrails.rules`, and the `build` agent's permissions in `.opencode/agents/build.md`. Codex rules match only the start of a command, so they catch fewer forms.
- Codex reads `.codex/` (agents, rules, MCP) only in a project the owner has trusted in Codex; AGENTS.md and the skills load either way.
- When you change a role, a guardrail or the MCP setup, change it for all three harnesses in the same pull request.

## Definition of done

A task is done when all of these hold:

1. Its acceptance criteria on its task are met and ticked; the task is In Review while the pull request is open and Done with a final summary after the merge.
2. Typecheck, lint and tests pass, with the output to show it, and the `verify` check passes on the pull request.
3. `reviewer` reports no blocking findings.
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
