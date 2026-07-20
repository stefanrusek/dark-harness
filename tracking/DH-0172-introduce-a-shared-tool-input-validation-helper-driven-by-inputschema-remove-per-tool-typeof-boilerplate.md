---
spile: ticket
id: DH-0172
type: bug
status: closed
owner: stefan
resolution: done
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

- Given a tool's declared `inputSchema` and a call missing a required field, when the tool's
  `execute()` runs, then it returns the same canonical `"<ToolName> tool error: '<field>' is
  required."` shaped error it did before the refactor, now produced by the shared
  `validateInput()` helper instead of hand-rolled `typeof` checks. Proven by
  `src/agent/tools/validate-input.test.ts` ("rejects a missing required field with 'is
  required.'") plus each migrated tool's own existing missing-field test cases (e.g.
  `todo-create.test.ts`, `web-fetch.test.ts`).
- Given a required string field that is present but empty, when validated, then the error is
  `"must be a non-empty string."`; given an optional field of the wrong type, then the error
  is the type-only message (`"must be a string."` / `"must be a number."` /
  `"must be a boolean."` / `"must be an array."` / `"must be an array of strings."` /
  `"must be an object."`). Proven by `validate-input.test.ts`'s per-type accept/reject cases.
- Given a tool with validation that doesn't decompose into per-field type checks (mutual
  exclusivity, enum membership, ctx-dependent checks, bespoke lenient parsing), when that
  tool is reviewed for migration, then it is deliberately left on hand-written logic rather
  than forced through the shared helper. Verified by inspection: `resolve-task.ts`,
  `monitor.ts`, `report-outcome.ts`, `todo-list.ts` (no input), and `tool-search.ts` (schema
  marks `query` required but runtime intentionally accepts `""`) were left unchanged; their
  existing test suites (`monitor.test.ts`, `report-outcome.test.ts`, `tool-search.test.ts`)
  continue to pass unmodified.
- Given the full quality-gate suite, when run after the migration, then `bun run typecheck`,
  `bun run lint`, `bun run test:coverage` (100% line coverage on every changed file,
  including the new `validate-input.ts`), and `bun run e2e` all pass.

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

**2026-07-18 — implemented.** Added `src/agent/tools/validate-input.ts`: a small,
inputSchema-driven validator (not a general JSON Schema engine) covering the shapes actually
used across tools — required/optional string (non-empty when required), number/integer,
boolean, array (including `items: { type: "string" }`), and object — producing the same
canonical `"<ToolName> tool error: '<field>' ..."` message format that was previously
copy-pasted per tool. Call sites do `const v = validateInput(schema, "Name", input); if
(!v.ok) return v.result;` then keep any genuinely tool-specific logic (mutual exclusivity,
enum checks, ctx-dependent checks) as local code afterward.

Migrated 19 tool files to use it: agent.ts, bash.ts, edit.ts, glob.ts, grep.ts, mcp-auth.ts,
notebook-edit.ts, read.ts, send-message.ts, skill.ts, task-output.ts, task-stop.ts,
todo-create.ts, todo-get.ts, todo-update.ts, web-fetch.ts, web-search.ts, write.ts, plus the
new validate-input.ts itself. One test fix: `web-fetch.test.ts` had a stale assertion for a
missing `url` field, split into separate missing-vs-empty cases to match the now-canonical
error text (no other behavior/error-text changes).

Deliberately not migrated (documented above and in the User Stories): `resolve-task.ts`
(different concern — name/id resolution, already factored out pre-DH-0172), `monitor.ts`
(combined cross-field message, doesn't decompose per-field), `report-outcome.ts` (bespoke
lenient parser, not type checks), `todo-list.ts` (no input), `tool-search.ts` (schema says
`query` required but runtime intentionally treats `""` as valid).

All four quality gates re-run and confirmed green: `bun run typecheck`, `bun run lint`,
`bun run test:coverage` (2203 pass, 0 fail, 100% line coverage on every changed file
including validate-input.ts), `bun run e2e` (38 pass, 0 fail). One coverage gap
(validate-input.ts line 70, a multiline ternary's closing paren attributed 0 hits by bun's
instrumentation) was fixed by collapsing the ternary onto one line via a local `const
message` — now genuinely 100%. Two flaky/unrelated failures were observed and confirmed
non-reproducing on rerun: `runtime.test.ts`'s DH-0013 fan-out-refusal test (passes in
isolation, timing-sensitive under full-suite load) and `e2e/build-stamp.test.ts`'s
--server real-build-stamp test (5s timeout, passed on immediate rerun) — neither touches
`src/agent/tools/`.

