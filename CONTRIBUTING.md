# Contributing to Dark Harness

This file is the external, contributor-facing counterpart to `CLAUDE.md`/`PLAYBOOK.md` — those
two govern how this project's own AI-agent fleet operates internally (ownership map,
escalation rules, roster conventions); this file is what a human (or another agent working on
someone else's behalf) needs to make a change and get it merged.

## Before you start

1. Read `README.md` for what `dh` is and how it's used.
2. Read `CLAUDE.md` for the stack, the directory ownership map (§3), and the hard invariants
   (§4) — changes that would set/change an invariant, or touch `src/contracts/`, need
   architect-level review per §6, not just a routine PR.
3. Check `tracking/` (Spile-format tickets, `tracking/views/dark-harness-view.md` for the
   current index) for existing open work before starting something that might duplicate it.

## Development setup

```bash
bun install
bun run dev              # run from source: bun run src/cli.ts
bun run build             # produces ./dist/dh
```

## Quality gates

Every change is judged against the same four commands CI runs (`CLAUDE.md` §5):

```bash
bun run typecheck      # tsc --noEmit (twice — root + src/web's own tsconfig)
bun run lint            # biome check .
bun run test:coverage   # bun test src --coverage — 100% coverage on new/changed code is a gate
bun run e2e             # bun test e2e — real compiled binary, PTY + headless browser + mock provider
```

Run `bun run lint:fix` / `bun run format` to auto-fix most formatting issues before a manual
lint pass.

## Directory ownership

Each top-level source directory belongs to one domain (`CLAUDE.md` §3: Contracts, Core,
Server, TUI, Web, Prompt, E2E, CI/Release). A change that only touches one domain's
directories is a normal PR; a change that needs to *cross* a boundary (e.g. a new wire event
type Server needs and TUI/Web both consume) should land the shared piece
(`src/contracts/`) first, reviewed as such, before the domain-specific consumers build
against it.

## Commit and PR conventions

- Commit before you consider a unit of work done — don't leave a dirty tree mid-task.
- Keep PRs scoped to one domain/ticket where practical; cross-domain changes should say so
  explicitly in the PR description.
- Reference the `tracking/DH-NNNN` ticket a change closes, if there is one.

## Where things live

- `docs/adr/` — locked architectural decisions; don't relitigate these in a PR, propose an
  amendment/new ADR instead if one seems wrong.
- `docs/handoffs/` — dated status logs per domain; historical record, not a contribution
  guide.
- `tracking/` — the current durable issue log (`tracking/SPILE-SPEC.md` documents the ticket
  format).
- `docs/troubleshooting.md`, `docs/tui-keybindings.md`, `docs/web-ui-guide.md`,
  `docs/instructions-authoring-guide.md`, `docs/jsonl-log-format.md`, `docs/mcp-servers.md`,
  `docs/skills-authoring-guide.md` — user-facing reference docs; update these alongside any
  change to the behavior they describe.
