---
spile: ticket
id: DH-0072
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: [DH-0054]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0072: Grep tool likely missing context-line flags, multiline mode, and file-type filter that real Claude Code's Grep supports

## Summary

dh's Grep tool (src/agent/tools/grep.ts, closed under DH-0054) supports pattern/path/glob/output_mode/-i/-n/head_limit, but real Claude Code's Grep additionally supports -A/-B/-C context-line flags, a multiline matching mode, and a 'type' parameter to filter by language/file type. This ticket only concerns parameter parity beyond DH-0054's original closed scope; it does not reopen or duplicate DH-0054.

## User Stories

### As an agent searching code, I want to see surrounding context lines and filter by file type the way real Claude Code's Grep lets me

- Given a Grep call with `-C 3`, when matches are found, then output includes 3 lines of
  context before and after each match (and similarly for `-A`/`-B`).
- Given a Grep call with `type: "ts"`, when searching, then only files of that language/type
  are searched, without needing a hand-rolled `glob` pattern.
- Given a Grep call against a file with genuinely multi-line constructs (e.g. a regex meant
  to span a `import {\n  X\n} from 'y'` block), when `multiline: true` is set, then `.`
  matches newlines as real Claude Code's Grep does.

## Functional Requirements

- `src/agent/tools/grep.ts`: add `-A`, `-B`, `-C` (numeric, context lines before/after/both),
  a `multiline` boolean flag (changes regex construction to allow `.` to match `\n` and
  scans file content as one block rather than line-by-line), and a `type` string parameter
  (language/file-type filter, e.g. `js`, `py`, `rust` -- a curated extension-to-type map).
- Confirm current default `head_limit` behavior (200) against real Claude Code's actual
  default and adjust if it's meant to be unlimited/different per output_mode.
- This is additive to the tool the DH-0054 work already shipped; no need to change
  `output_mode`, `-i`, `-n`, `pattern`, `path`, or `glob`, which already match.

## Assumptions

- The current session did not have direct access to a live Grep/Glob tool schema to
  cross-check parameter-for-parameter (Grep/Glob were not in this session's own tool list);
  this ticket is filed on the strength of a source-reading subagent's report of
  `src/agent/tools/grep.ts`, cross-referenced against general knowledge of real Claude
  Code's Grep tool. Confidence is good but not as high as tickets filed against tools this
  session could directly inspect -- worth a quick recheck against real Claude Code's Grep
  tool schema before implementation.

## Risks

- None significant; this is additive parameters on an existing, working tool.

## Open Questions

- Exact default/max for `head_limit` per output_mode, and exact behavior of `-A`/`-B`/`-C`
  interacting with `output_mode: "files_with_matches"` (context lines presumably only apply
  in `content` mode) need to be nailed down against real Claude Code's Grep before
  implementation.

## Notes

> [!NOTE]
> Found 2026-07-16 during the systematic tool-schema/behavior comparison against real
> Claude Code prompted by the owner following DH-0069. Relates to, but does not reopen or
> duplicate, DH-0054 (closed, done) -- that ticket covered "no first-class Grep/Glob tool at
> all"; this covers parameter parity beyond what DH-0054's implementation delivered.
