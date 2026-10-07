# Budget Buddy

Instructions for every agent working in this repository.

Product requirements are in `docs/requirements.md`. Read it before writing or building a spec: it records what the owner has already decided, including the main stack choices.

The design spec is in `docs/design-spec.md`. Read it before planning or building anything on screen: it records the layout, behaviour, copy and visual system the owner approved in the prototype. Build styling on `docs/design/html/bb.css` (documented in `docs/design/html/styleguide.html`), and use `docs/design/html/screens/` (HTML and PNG per screen) as the visual reference. The raw prototype files are in `docs/design/prototype/`.

## Stack and commands

Not decided yet. The first spec in `docs/specs/` chooses the stack; once it does, record here:

- Stack and versions
- Install, dev server, typecheck, lint, unit test and end-to-end test commands

Until this section is filled in, ask the user instead of assuming a stack.

## How the team works

- `plan` (primary) writes a spec with a task list to `docs/specs/<nn>-<slug>.md`. It does not write application code.
- `build` (primary) implements one task at a time from a spec and delegates:
  - `explore` for finding code and reading documentation (read-only, local model)
  - `tester` for writing tests and running the verification commands
  - `reviewer` for an independent read-only review of the diff
- The spec file is the shared state. Tick tasks off in it and update it when the design changes.

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
