---
spile: ticket
id: DH-0172
type: bug
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0172: Introduce a shared tool-input validation helper driven by inputSchema; remove per-tool typeof boilerplate

## Summary

Every tool declares an inputSchema but validates by hand; the same error strings are copy-pasted across 20+ tool files.

## Domain / owner

Core — src/agent/tools/ (Grace)

## User Stories

_To be written at `refining` (draft filed by refactoring round DH-0169)._

## Notes

Filed by Fable during refactoring round DH-0169.

Every tool declares a `JsonSchema inputSchema` (`tools/types.type.ts:11-16`) but **none uses
it to validate** — each `execute()` re-checks argument shapes by hand. The string
`"must be a non-empty string"` appears ~42 times and the `"<Tool> tool error:"` prefix is
repeated across ~23 files. `todo-create.ts:45-73` alone has four separate
`typeof input.x !== "string"` blocks. Only `resolve-task.ts` has factored anything out.

This is copy-paste with a fixed error-message format that will drift, and it means the
declared schema and the runtime check can silently disagree. Suggested: a shared
validation helper driven by `inputSchema` (or a small typed-argument extractor) with a
single canonical error-message format, applied across the tool set.

Scope note: `src/config/validate.ts`'s 58 hand-thrown `ConfigError`s are a **deliberate**
cohesive hand-rolled validator (per its own comments) and are explicitly OUT of scope here.

