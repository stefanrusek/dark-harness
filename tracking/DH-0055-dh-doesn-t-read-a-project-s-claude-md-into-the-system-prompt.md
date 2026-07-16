---
spile: ticket
id: DH-0055
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0055: dh doesn't read a project's CLAUDE.md into the system prompt

## Summary

Real Claude Code automatically reads a project's CLAUDE.md and injects it into context as binding project-specific instructions. dh has no equivalent -- a project's own CLAUDE.md (conventions, invariants, ownership map) is invisible to dh's agent loop unless an operator manually folds it into config.systemPrompt. Given HANDOFF.md's explicit requirement that tool/behavior semantics mirror Claude Code, this is a real parity gap, not a nice-to-have.

## User Stories

### As an operator running `dh` against my own project, I want its CLAUDE.md automatically honored, the same way real Claude Code does

- Given a `CLAUDE.md` file exists in the working directory (or project root), when `dh` builds
  its system prompt, then that file's content is read and injected into context as
  additional, binding project-specific instructions — without the operator having to
  manually copy it into `config.systemPrompt`.
- Given no `CLAUDE.md` exists, when `dh` starts, then behavior is unchanged from today (no
  error, no missing-file warning spam).
- Given `config.systemPrompt` is also set (a full override, per existing behavior), when both
  are present, then the interaction between the override and CLAUDE.md auto-injection is
  well-defined and documented (implementer's call on the exact precedence — likely CLAUDE.md
  is additive on top of either the default prompt or the override, mirroring how real Claude
  Code layers project instructions on top of its own base behavior rather than one replacing
  the other).

## Functional Requirements

- Given a `CLAUDE.md` larger than some reasonable size, when injected, then it doesn't
  silently blow the context budget — implementer's call on whether to cap/truncate with a
  clear signal, matching this project's own "no silent truncation" convention.

## Assumptions

- Real Claude Code's actual CLAUDE.md-loading behavior (nested CLAUDE.md files in
  subdirectories, a user-level `~/.claude/CLAUDE.md`, etc.) may be more elaborate than a
  single-file read — start with the simple case (one `CLAUDE.md` at the working directory
  root) and treat anything further as a follow-up, not a blocker for this ticket.

## Notes

> [!NOTE]
> Raised directly by the owner during Bucket B triage discussion (2026-07-15), prompted by
> noticing dh doesn't mirror this specific real-Claude-Code behavior. Ties into HANDOFF.md
> §4's explicit "semantics mirror Claude Code's tools of the same name" requirement and the
> broader tool-conformance audit (DH round 13) — this is prompt/context-loading conformance
> rather than tool-call conformance, so it wasn't in that audit's scope, but is the same
> spirit of gap.
