---
spile: ticket
id: DH-0237
type: bug
status: verifying
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0235]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0237: REQUIRED_CONTRACT in system-prompt.ts has accreted the whole Output-format section; doc comment is now stale and override-inheritance is undocumented

## Summary

src/prompt/system-prompt.ts REQUIRED_CONTRACT is documented as just the TASK_FAILED convention + logging notice, but now also embeds the full '## Output format' section (markdown + colored spans + ASCII art, heavily expanded by DH-0206/0229/0233) and '## Logging'. Because REQUIRED_CONTRACT is always appended after a config.systemPrompt override, operators silently inherit all of that formatting guidance with no doc noting it. Extract the Output-format guidance into its own named constant and make the append-after-override decision explicit, or at minimum correct the doc comment.

## User Stories

### As a domain lead reading system-prompt.ts, I want REQUIRED_CONTRACT's doc comment to accurately describe its contents, so I don't have to re-derive what it actually contains by reading the whole string literal

- Given `REQUIRED_CONTRACT`'s doc comment, when I read it, then it describes only the
  `TASK_FAILED` self-report convention — not the Output-format or Logging guidance, which now
  live in a separate, equally well-documented constant.
  Proven by: `src/prompt/system-prompt.test.ts` — "REQUIRED_CONTRACT carries the TASK_FAILED
  marker on its own" (asserts `REQUIRED_CONTRACT` contains `TASK_FAILED` only) and "OUTPUT_
  FORMAT_SECTION carries the Markdown rendering instruction and the logging notice" (asserts
  the Output-format/Logging content moved to `OUTPUT_FORMAT_SECTION`).

### As an operator supplying a `config.systemPrompt` override, I want it documented what unconditionally gets appended after my custom prompt, so I'm not silently surprised by inherited formatting guidance

- Given a `config.systemPrompt` override, when `loadSystemPrompt` builds the final prompt,
  then both `REQUIRED_CONTRACT` and `OUTPUT_FORMAT_SECTION` are appended explicitly and in
  that order at the call site, and `loadSystemPrompt`'s own doc comment names both constants
  and why each survives an override.
  Proven by: `src/prompt/system-prompt.test.ts` — "reads and trims an override file, but
  always appends the TASK_FAILED contract and the output-format contract" (asserts the exact
  `override\n\nREQUIRED_CONTRACT\n\nOUTPUT_FORMAT_SECTION` shape) and "override still gets the
  Output format contract appended"; `src/cli.test.ts` — the `createRuntime` system-prompt
  override test asserts the same concatenation end-to-end through `main()`.

## Functional Requirements

- Extract the Output-format (Markdown/colored-span/ASCII-art) and Logging guidance out of
  `REQUIRED_CONTRACT` into a new, separately-documented constant, `OUTPUT_FORMAT_SECTION`,
  matching this file's existing naming convention (`AVAILABLE_TOOLS_SECTION`).
- No change to the actual prompt wording/content of either section — structural/naming
  cleanup only.
- Both constants continue to be appended after a `config.systemPrompt` override, and after
  `DISCIPLINE_PROMPT` in the default (non-overridden) prompt — no behavior change to what the
  model actually sees.
- `REQUIRED_CONTRACT`'s doc comment is corrected to describe only what it now contains.
- `loadSystemPrompt`'s doc comment and the append call site make explicit, by name, both
  constants that survive an override.

## Assumptions

- The ticket's own suggested remedy offers two options (separate constant with explicit
  append, or a corrected doc comment alone); this implementation takes the "separate constant"
  path since it also gives future edits (e.g. another DH-0206-style formatting tweak) an
  unambiguous home that isn't `REQUIRED_CONTRACT`.
- "Make the append-after-override behavior explicit" is read as: do not silently change *which*
  sections survive an override (that would be a behavior change, out of scope per the ticket's
  own "not a rewrite of the guidance" instruction) — only make it visible/documented at the
  call site and in doc comments.

## Risks

- None beyond the usual "large string literal reshuffle" risk of a stray backtick/paren
  mismatch — mitigated by running the full gate suite (typecheck/lint/test:coverage/e2e).

## Open Questions

## Notes

### 2026-07-19 — implementation
Split `REQUIRED_CONTRACT` (`src/prompt/system-prompt.ts`) into `REQUIRED_CONTRACT` (TASK_FAILED
convention only) and a new `OUTPUT_FORMAT_SECTION` (Output-format + Logging guidance, DH-0206/
0229/0233/0234's accreted content). `BASE_PROMPT` and `loadSystemPrompt`'s override path now
append both explicitly. Doc comments on `REQUIRED_CONTRACT`, `OUTPUT_FORMAT_SECTION`,
`buildDefaultSystemPrompt`, and `loadSystemPrompt` updated to name both constants. Updated
`src/prompt/system-prompt.test.ts` and `src/cli.test.ts` accordingly. No prompt wording
changed — verified by diffing the concatenated output byte-for-byte against the prior single
`REQUIRED_CONTRACT` string.

### 2026-07-19 — gates, transitioned to verifying
`bun run typecheck`: pass. `bun run lint`: pass. `bun run test:coverage`: 146/146 pass, 100.0%
line coverage (15657/15657 lines). Two unrelated flaky failures were seen mid-run on the first
attempt — `src/agent/loop.test.ts` (DH-0093 mid-session model switch cost accounting) and
`src/web/server.test.ts` (DH-0128 cross-machine config resolution) — both reproduced as
failing then passing across reruns, and confirmed unrelated to this ticket's files by
stashing this change entirely and rerunning: the flake persisted. A clean rerun with this
change in place passed 146/146. `bun run e2e`: 41/41 pass. Transitioned draft -> verifying.
