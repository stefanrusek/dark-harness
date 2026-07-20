---
name: spile-ops
description: "Mechanical operations on this repo's Spile ticket tracker (tracking/): minting a new ticket with correct front matter and ID, transitioning a ticket's status, and regenerating tracking/views/dark-harness-view.md. Use this whenever asked to file/create a ticket, move a ticket between statuses (draft/refining/ready/implementing/verifying/closed), close a ticket, or refresh the tracker view — instead of hand-writing or hand-editing ticket markdown files. This is process tooling for dark-harness's own coordination, per tracking/SPILE-SPEC.md and tracking/DH-0008-adopt-spile-ops-skill.md — not part of the dh product itself."
---

# spile-ops

Mechanizes the pure-mechanics slice of running this repo's Spile-based ticket tracker
(`tracking/`), per `tracking/SPILE-SPEC.md`. It does **not** do judgment work — deciding
what a ticket should say, whether it's ready to transition, how to word acceptance
criteria — that's `spile-authoring`'s job (per the spec) or the human/coordinator's. This
skill only handles: correct formatting, ID minting, status bookkeeping, and view
regeneration, so no one burns context hand-writing tickets or the view doc.

No upstream `spile-ops` skill package exists to adopt (checked, see DH-0008) — this is a
project-local implementation built directly against the spec, living at
`.claude/skills/spile-ops/`.

All three scripts require only Python 3 stdlib (`python3` on PATH) — no venv, no pip
install, no dependency on the `dh` Bun toolchain. Always run them from anywhere inside the
repo; they resolve `tracking/` relative to their own script location, not the caller's cwd.

## Creating a new ticket

Run:

```
python3 .claude/skills/spile-ops/scripts/new_ticket.py \
  --title "Short title" \
  --type feature \
  --owner stefan \
  --status draft \
  --summary "One paragraph: what this is and why."
```

- `--type` is `feature` or `bug` (required).
- `--status` defaults to `draft`; only `draft`, `refining`, or `ready` are valid initial
  statuses (a ticket is never minted already `implementing`+ — use `transition.py` after,
  if that's genuinely intended).
- `--owner` defaults to `stefan` (the project's usual accountable human) — pass a different
  value if asked to attribute to someone else.
- `--depends-on ID,ID`, `--relates-to ID,ID`, `--blocked-by "reason or ID"` are optional and
  map to `relations.depends_on`, `relations.relates_to`, and `blocked_by` respectively.
- The script mints the next ID by reading `tracking/README.md`'s `counter:` field, writes
  `tracking/DH-NNNN-<slugified-title>.md` with the full front matter + body skeleton from
  `SPILE-SPEC.md`'s "Ticket body" section (Summary filled in if given; User Stories,
  Functional Requirements, Assumptions, Risks, Open Questions, Notes left as `TODO`
  placeholders for the follow-up authoring pass), then bumps the counter in
  `tracking/README.md` — **only after** the ticket file write succeeds, so a failed write
  never burns an ID.
- It then regenerates the view doc automatically (pass `--no-regen` to skip, e.g. for
  scripted tests that will clean up before a human ever looks at the view).
- Prints the created file path on success. **Immediately fill in the TODO sections** — the
  script only handles mechanics; the actual Summary/User Stories/Acceptance Criteria content
  is a judgment call for whoever requested the ticket (or a `spile-authoring`-style pass).

**Mint only from the coordinator's primary checkout, never from an isolated implementer
worktree.** `tracking/README.md`'s `counter:` field is a tracked file with one physical
copy per worktree — two isolated worktrees each read the same counter, each mint the same
`DH-NNNN` ID, and nothing collides until the branches are merged (this happened for real:
`DH-0213` was independently minted twice during refactoring round DH-0216, see
`tracking/DH-0217-*.md`). This is not a same-filesystem race a lock would fix, since the
writers are on physically separate checkouts. `new_ticket.py` enforces this itself — it
refuses to run (via `common.die_if_linked_worktree`) when `git rev-parse --git-common-dir`
differs from `--git-dir`, i.e. whenever it's invoked from a linked worktree rather than the
main working tree — so a ticket-filing request that lands in a dispatched worktree should
be relayed back to the coordinator's own checkout rather than run in place.

## Transitioning a ticket's status

Run:

```
python3 .claude/skills/spile-ops/scripts/transition.py DH-0008 implementing
python3 .claude/skills/spile-ops/scripts/transition.py DH-0008 closed --resolution done
python3 .claude/skills/spile-ops/scripts/transition.py DH-0004 draft --blocked-by "owner decision on packaging shape"
python3 .claude/skills/spile-ops/scripts/transition.py DH-0004 ready --clear-blocked-by
```

- Positional args: ticket ID (must match an existing `tracking/DH-NNNN-*.md` file — the slug
  doesn't matter, only the ID prefix) and the new status (one of `draft`, `refining`,
  `ready`, `implementing`, `verifying`, `closed`).
- Closing a ticket (`closed`) **requires** `--resolution done|wontfix|duplicate|superseded`
  — the script refuses to close without one, since the spec ties `closed` to a resolution
  as a linear-lifecycle substitute for separate done/wontfix statuses.
- `--blocked-by "text"` / `--clear-blocked-by` set or clear the `blocked_by` field.
  Blockage is orthogonal to status per the spec — you can block a ticket at any status.
- `--owner NAME` reassigns the accountable human if asked.
- The lifecycle (`draft → refining → ready → implementing → verifying → closed`) is
  **advisory, not enforced** (spec's explicit design principle) — an out-of-order jump
  prints a warning to stderr but still succeeds. Don't second-guess a requested transition
  just because it skips a stage; just execute it and surface the warning.
- Regenerates the view doc automatically afterward (again, `--no-regen` to skip).

All ticket-by-ID lookups (in `transition.py`, `rename_ticket.py`, and any future script) go
through one shared resolver, `resolve_ticket_path(ticket_id)` in `scripts/common.py`: it globs
`tracking/DH-NNNN-*.md` for the given ID and returns the single match, erroring loudly if
there are zero (no such ticket) or more than one (data corruption — two files claiming the
same ID). Nothing should hand-roll its own `ls`/`grep`/`os.listdir` lookup against
`tracking/` — use this helper instead.

## Renaming a ticket's filename slug

Run:

```
python3 .claude/skills/spile-ops/scripts/rename_ticket.py DH-0002 "New title"
```

A ticket's filename slug is set once at creation time and never auto-updates, so it can go
stale when a ticket's scope/title changes meaningfully after the fact (e.g. narrowed scope,
renamed feature). Call this explicitly when that's happened — not for every minor rewording,
that would just be noisy churn. It resolves the current file via `resolve_ticket_path`,
computes the new slug with the same `slugify()` `new_ticket.py` uses, refuses to run if a
file with the new slug already exists (never overwrites another ticket's file), does a `git
mv` to the new filename, updates the ticket's H1 heading line to match the new title, and
regenerates the view doc afterward (`--no-regen` to skip, same as the other two scripts).

## Regenerating the view doc

Run directly if you've hand-edited a ticket file outside the two scripts above (rare — but
covers e.g. a bulk find/replace), or any time the view might be stale:

```
python3 .claude/skills/spile-ops/scripts/regen_view.py
```

Rewrites `tracking/views/dark-harness-view.md` from scratch by scanning every
`tracking/DH-NNNN-*.md` ticket's front matter:

- **Needs Attention**: every ticket with status `refining` or `verifying`, plus every ticket
  with a non-empty `blocked_by`, regardless of status.
- **Board**: every non-closed ticket, grouped into `###` subsections by status in lifecycle
  order (empty statuses are omitted, not shown as empty headers). A 🔒 badge marks a blocked
  ticket inline.
- **Recently Closed**: the 15 most recently-closed tickets (by file order — closed tickets
  keep accruing at the end of the ID sequence in practice), most recent first, with
  resolution. Older closed tickets remain fully readable in git/`tracking/`; they're just
  not repeated in this generated summary.

The doc always carries the `spile: view` discriminator and a generated-do-not-hand-edit
header per spec. **Never hand-edit `tracking/views/dark-harness-view.md` directly** — it
will just be overwritten on the next regeneration; edit the ticket files and rerun this
script (or let `new_ticket.py`/`transition.py` do it for you).

## Design notes

- Front matter is edited line-by-line via simple string matching (see `scripts/common.py`),
  not a YAML library — the schema in `SPILE-SPEC.md` only uses a small, flat-ish subset of
  YAML (scalars plus single-level bracket lists), so this avoids a parsing dependency at
  the cost of not handling arbitrary YAML. If a ticket's front matter grows genuinely nested
  structure beyond what `SPILE-SPEC.md` shows, this tooling will need a real YAML parser —
  flag that as a limitation rather than silently mangling the file.
- Per the spec's "advisory, not enforced" principle, these scripts encourage the happy path
  but avoid hard failures on unusual states (e.g. an odd transition just warns). They do
  hard-fail on genuinely malformed input (missing front matter, missing required field to
  edit, closing without a resolution) since those are mechanical prerequisites, not
  workflow judgment calls.
