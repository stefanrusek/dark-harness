---
spile: ticket
id: DH-0134
type: feature
status: implementing
owner: stefan
resolution:
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: [DH-0133]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0134: UI overhaul phase 1: Core toolchain integration for React + Ink

## Summary

Per Fable's DH-0133 design (2026-07-17): add React and Ink to the build (scripts/build.ts, package.json), verify bun build --compile bundles them cleanly into the single binary, measure resulting binary size/startup delta against current builds, and pick+verify a component-testing approach compatible with bun test (React Testing Library for Web, ink-testing-library for TUI). Short, mostly-mechanical, but a hard prerequisite -- Web/TUI migration work (DH-0133b/DH-0133c) should not start until this lands. Core domain (Grace).

## User Stories

### As a TODO, I want TODO

- Given TODO, when TODO, then TODO.

## Functional Requirements

- TODO

## Assumptions

## Risks

## Open Questions

## Notes
