---
spile: ticket
id: DH-0041
type: feature
status: draft
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

# DH-0041: A cluster of user-facing documentation is entirely missing

## Summary

The docs audit's full README cross-check found the README's factual claims (CLI flags, config
schema, mode matrix, exit codes, quick-start, license) are all accurate — but a substantial set of
documentation an operator of an unattended agent harness would need simply doesn't exist anywhere
in the repo: a TUI keybindings reference (operators starting `dh` with no flags get a TUI with no
visible help on what keys do what); a Web UI usage guide (no explanation of the tree/output layout,
token/cost display, or log-download actions); an instructions-file authoring guide (HANDOFF's
primary use case revolves around this file, and there's no guidance on format/structure/examples);
a user-facing JSONL log-format reference (ADR 0005 defines the schema but only as internal
technical documentation, not for operators building analysis tooling); MCP server configuration
examples (the field exists, no worked examples); a skills-authoring guide (the SKILL.md convention
is used but never documented for extenders); a troubleshooting/FAQ page; a CHANGELOG; a
CONTRIBUTING.md distinct from the internal CLAUDE.md/PLAYBOOK.md; and (see DH-0036) container/
deployment documentation.

## User Stories

### As an operator, I want to discover the TUI's keybindings without reading source code

- Given the console TUI, when documentation is consulted, then a keybindings reference exists
  (left-arrow to tree, escape/q to return, enter to send, etc.).

### As an operator, I want to know how to write an effective instructions file

- Given the `--instructions` flag, when I look for guidance, then a doc explains the expected
  format, suggested structure (goal, scope, constraints, success criteria), and includes examples.

### As a fleet operator building log-analysis tooling, I want a user-facing JSONL schema reference

- Given `.dh-logs/`, when building external tooling against it, then a documented schema reference
  (not just an internal ADR) describes the header line and event vocabulary.

## Functional Requirements

- Given each of the above, when authored, then they live in `docs/` or README sections consistent
  with the rest of the project's documentation conventions.

## Notes

> [!NOTE]
> Source: Docs completeness audit findings #4 through #12 (TUI keybindings, Web UI guide,
> instructions-authoring guide, JSONL format reference, MCP config examples, skills-authoring
> guide, troubleshooting/FAQ, CHANGELOG, CONTRIBUTING). Container/deployment docs are tracked
> separately as **DH-0036** since they overlap with the ops audit's container finding.
