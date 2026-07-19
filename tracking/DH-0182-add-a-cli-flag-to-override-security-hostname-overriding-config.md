---
spile: ticket
id: DH-0182
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: [DH-0022, DH-0168, DH-0166]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0182: Add a CLI flag to override security.hostname, overriding config

## Summary

DH-0022 gave the bind address a dh.json-only mechanism (security.hostname) with no CLI flag override. Owner decision (2026-07-18, made while reviewing DH-0168's port design): for both host and port, support both a config field and a CLI flag, with the flag overriding config when both are set. This ticket is the host-side half of that decision — DH-0168 is the port-side half. Add a --host (or --web-host / --bind-host, naming TBD to avoid collision with any existing flag) CLI flag that, when set, overrides dh.json's security.hostname for that invocation only; when unset, security.hostname (or its absence, i.e. bind-all) behaves exactly as today. Should follow the same validation/plumbing pattern DH-0168 establishes for --web-port (FLAGS_WITH_VALUES, HELP_FLAG_ITEMS, parseArgs validation, threaded to DhServer/serveWebUi call sites). Note: this changes DH-0022's original design (config-only, no flag) per direct owner instruction, not a routine implementer call — safe to build since the owner made the call explicitly, but worth noting in Notes that it revises a previously-closed ticket's decision.

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
