---
title: Untitled
name: spile
version: 0.2.0
status: draft
---

# Spile

Spec-driven issue tracking in markdown, front matter, and directories.

Spile is a filesystem-native replacement for Jira, designed for Specification-Driven Development. A ticket is not a pointer to work — it **is** the spec. It is the driving artifact an SDD pipeline consumes, and the same artifact the pipeline updates as work progresses. Humans and agents read and write the same files, with git as the canonical store and audit trail.

Spile works standalone against any git repository. It is also designed to be a first-class document type in Sugar Maple, where tickets get rich rendering and semantic MCP verbs.

## Design principles

**The ticket is the spec.** Spec quality is the critical investment; everything downstream of a `ready` ticket can in principle run unattended.

**Git is the authority.** Spile adds conventions on top of markdown files in git; it adds no database, no server, and no state that git doesn't already hold. Anything derivable from git history (last-updated times, who changed what) is not duplicated in front matter.

**Advisory, not enforced.** Because everything is markdown in git, nothing prevents any state from becoming any other state, and Spile accepts this. Conventions describe the happy path; tooling encourages it and renders gracefully around deviations. It never errors on the unexpected.

**Paths are addresses, IDs are identity.** Renames are inevitable. The immutable ID in front matter is a ticket's identity; all cross-references use the ID, and tooling resolves IDs to current paths.

**Type is metadata, not taxonomy.** Features and bugs share one document shape and one directory. A bug is a feature spec written from the corrected state.

## Structure

### The project directory

Each project is one flat directory. There are no status or type subdirectories; tickets never move as they progress.

```
spile/                                  ← project directory
  README.md                             ← root doc (config + project docs)
  SPILE-0001-spile-ops-skill.md         ← a ticket
  SPILE-0001-spile-ops-skill/           ← optional sidecar for that ticket
  SPILE-0002-spile-authoring-skill.md
  views/
    spile-view.md                       ← the generated view doc
```

### The root doc

`README.md` at the project root is the root doc. Its front matter is the project registry:

```yaml
---
spile: project
project: Spile
prefix: SPILE
counter: 2        # last allocated ID number
---
```

Its body is human-facing documentation for the project and its tracker. The counter makes ticket creation a serialization point: two branches that both mint an ID will conflict on this file at merge, which is deliberate — the conflict is small, mechanical, and forces the collision to be resolved.

The root doc front matter may also carry project-level extensions (component lists, custom status vocabulary) as needed.

### Tickets

A ticket is a single markdown file named `{PREFIX}-{NNNN}-{slug}.md`, for example `SM-0002-add-mcp-support.md`.

The `{PREFIX}-{NNNN}` portion is the ticket ID: the project prefix plus a zero-padded number allocated from the root doc counter. The ID is immutable. The slug is decoration — a kebab-case rendering of the title that may change freely when the ticket is renamed. References between tickets always use the bare ID (`SM-0002`), never the filename, so renames break nothing that tooling resolves.

### Sidecar directories

A ticket may have a sidecar directory with the same basename (`SM-0002-add-mcp-support/`) holding supporting artifacts: mockups, diagrams, research notes, agent-generated analysis, logs. The rule is strict: **nothing normative lives in the sidecar.** The ticket file is the single source of truth; the sidecar is annex. A rename must move the ticket and its sidecar together.

## Ticket front matter

The core schema:

```yaml
---
spile: ticket            # marks the document kind; see The spile discriminator
id: SM-0002
type: feature            # feature | bug
status: refining         # see Lifecycle
owner: alice             # the accountable human
resolution:              # set when closed: done | wontfix | duplicate | superseded
blocked_by: []           # ticket IDs or freeform reasons; empty means unblocked
created: 2026-07-02
relations:
  depends_on: [SM-0001]
  relates_to: []
  supersedes: []
implementation:          # where execution lives; a list, all keys optional
  - repo: sugarmaple-server
    branch: SM-0002-add-mcp-support
    pr: 42
---
```

Field notes:

- **spile** — the document-kind discriminator (see *The spile discriminator* below).
- **id** — immutable identity. Must match the filename prefix.
- **type** — `feature` or `bug`. Informational only; both types share the same shape and lifecycle.
- **owner** — the human accountable for the ticket, typically the one running the SDD process. Not "who is doing the work" — the pipeline does the work; the owner answers for it.
- **resolution** — why a closed ticket closed. `closed` + `resolution` replaces separate done/wontfix statuses so the lifecycle stays linear.
- **blocked_by** — blockage is orthogonal to status. A ticket can be blocked while refining or while implementing without losing its place in the lifecycle. Renderers show blockage as a badge, not a column.
- **created** — written once at mint time. There is deliberately no `updated` field; git knows.
- **implementation** — pointers to where execution happens: repo (omit if unambiguous), branch, PR. The PR is the durable reference after merge. Soft convention: branches carry the ticket ID. The tracker may live in the same repo as the code or a separate one; the schema supports both and imposes no default.

There is deliberately no `priority` field. Projects may extend front matter freely as long as core fields keep their meaning.

## The spile discriminator

Every Spile-managed markdown file declares itself with a `spile` front matter key so tools — renderers, view generators, and future Sugar Maple features — can detect Spile documents without relying on paths or filenames:

```yaml
spile: ticket     # a ticket
spile: project    # a root doc
spile: view       # a generated view doc
```

Detection is the key's **presence**; dispatch is its **value**. A file with no `spile` key is not a Spile document, whatever directory it sits in — and a Spile document remains one wherever it is moved. Consistent with the advisory principle, tooling treats an unknown `spile` value as an unrecognized-but-Spile document: render generically, never error. Sugar Maple's rich ticket rendering and semantic MCP verbs key off this field.

## Ticket body

The canonical skeleton, in order:

```markdown
# SM-0002: Add MCP support

## Summary

What this is and why, in prose — for a problem-driven ticket, this doubles as a brief problem statement.

## User Stories

### As an agent, I want to transition ticket status

- Given a ticket in `ready`, when the pipeline claims it, then its status becomes `implementing`.
- Given a non-standard transition, when it is requested, then it succeeds with a warning.

### As an owner, I want to see what is blocked

- Given a ticket with a non-empty `blocked_by`, when the view regenerates, then the ticket appears in Needs Attention.

## Functional Requirements

- Given any mutation to a ticket, when it completes, then the project view doc is regenerated in the same change.

## Assumptions

## Risks

## Open Questions

## Notes

> [!NOTE]
> Non-normative context, e.g. a bug's current (incorrect) behavior.
```

Rules and conventions:

- **Summary** is one paragraph: what this ticket is and why it exists. For a ticket driven by a specific problem (a bug, a regression, a gap someone hit), this is also where the problem brief lives — state the problem plainly here rather than scattering it across User Stories or a Notes aside. Keep it to a paragraph; a bug's full current-behavior detail still belongs in a non-normative Notes block, not Summary.
- **User stories** take the form *"As an actor, I want to do thing."* They are intent slices within the ticket, not independently tracked units. Each is an H3 under `## User Stories`.
- **Acceptance criteria** are Given/When/Then statements scoped to a single story, listed under that story's heading. They define and narrow the story's intent, and are the primary input to test generation.
- **Functional requirements** may also be Given/When/Then but cut across the ticket rather than belonging to one story — invariants and cross-cutting constraints on the whole implementation.
- **GWT container**: plain list items are the house style. Fenced ` ```gherkin ` blocks are also accepted; parsers must handle both.
- **Optional tail sections** (Assumptions, Risks, Open Questions, Notes, and others as needed) hold nuance without polluting the normative core. They are non-normative unless explicitly stated otherwise. Non-normative asides inside normative sections use blockquotes or `> [!NOTE]` admonitions so the distinction is both visual and syntactic.
- There is no per-story progress tracking in the ticket. Execution progress belongs to the SDD framework and the code repo; the ticket points at it via `implementation`.

### Bugs

A bug is written as a spec of the corrected state. What the system *should* do becomes the user story; correct behavior becomes the acceptance criteria. The current broken behavior is captured as a non-normative note — a hint for locating the defect, not part of the contract. This keeps bug tickets valid after the fix: they describe intended behavior, not a diff from a broken state, and the pipeline needs no separate bug-fixing mode.

## Lifecycle

```
draft → refining → ready → implementing → verifying → closed
```

- **draft** — not ready for sharing.
- **refining** — shared and under active refinement toward pipeline readiness.
- **ready** — finalized as pipeline input. The `refining → ready` transition is the gate: the human sign-off moment. Everything after it can in principle be autonomous.
- **implementing** — the pipeline is actively driving from the spec.
- **verifying** — implementation exists; acceptance criteria are being checked. Skippable in fully automated environments. A failed verification drops back to `implementing`, or to `draft`/`refining` if the spec itself was the problem — which is diagnostic gold.
- **closed** — terminal, with `resolution` explaining why. A closed ticket remains a valid description of intended behavior; a regression is a **new** bug ticket referencing the old one, not a reopened ticket.

Natural transition owners: `draft → ready` stages belong to humans; `ready → implementing → verifying` belong to the pipeline; `verifying → closed` belongs to whoever owns acceptance. The state machine is advisory — tooling encourages the happy path, warns on odd transitions, and enforces nothing.

## Views

Agents don't need views; they query front matter directly or use MCP verbs. Views exist for humans, and each project gets exactly **one generated view doc** (`views/{project}-view.md`, front matter `spile: view`) with three sections, in priority order:

1. **Needs Attention** — tickets waiting on a person: everything `refining`, everything `verifying`, and everything blocked (with what it's blocked by). This is the view that replaces the standup.
2. **Board** — open tickets grouped by status, as tables: linked ID, title, type, owner, blocked badge, PR link.
3. **Recently Closed** — the last 10–15 closed tickets with resolutions. The full archive is git and grep.

Rules for generated docs:

- They carry a header marker — *generated, do not hand-edit* — plus the source they were built from.
- Regeneration is owned by the mutation path: every ticket change regenerates the view in the same change. Standalone users get the generator as a CLI, wirable to a pre-commit hook or CI. A CI freshness check is the backstop.
- Ad hoc questions (per-owner dashboards, custom filters, rollups) are answered at the MCP level via search verbs and a visualizer skill — ephemeral views for ephemeral questions. Only the one canonical view lives in git.

## Tooling layers

Spile is usable at three levels, each strictly derivative of this spec:

1. **Ad hoc** — a human or agent following this document with a text editor and git. The spec alone is sufficient.
2. **Skills** — two portable agent skills operate the process anywhere, with or without Sugar Maple:
   - **spile-ops** — the process mechanic: formats, scaffolding, ID minting, transitions, view regeneration. See ticket SPILE-0001.
   - **spile-authoring** — spec craft and gate judgment: drafting quality stories and criteria, and advising readiness for stage transitions. See ticket SPILE-0002.
3. **Sugar Maple MCP + renderer** — semantic verbs (create, transition, query, rename-with-sidecar) with the schema enforced at the tool boundary, rich ticket rendering, and automatic view regeneration on every mutation.

When spec and tooling disagree, the spec wins. Skill and tooling updates follow spec updates, never the reverse.
