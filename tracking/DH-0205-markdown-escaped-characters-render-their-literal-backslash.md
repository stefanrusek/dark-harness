---
spile: ticket
id: DH-0205
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0108]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0205: Markdown: escaped characters render their literal backslash

## Summary

Manual testing finding (2026-07-19): \* renders as the literal two characters \* instead of an escaped asterisk. Standard markdown character-escaping isn't implemented/working in the current renderer. Real correctness bug, not a feature gap.

## User Stories

### As a user writing markdown-formatted assistant output that needs a literal punctuation character (e.g. a literal `*`), I want `\*` to render as `*`, so I can escape markdown syntax characters instead of getting either literal `\*` or accidental emphasis parsing.

- Given inline markdown `\*not emphasis\*`, when it's parsed, then the output text is `*not emphasis*` with no `emphasis` node produced (the backslash-escaped asterisks never trigger emphasis matching, and the backslash itself is dropped). Proven by the new "escaped asterisk stays literal, doesn't trigger emphasis" fixture in `src/markdown/rendering-fixtures.ts`, exercised in `src/tui/markdown-ansi.test.ts` and `src/web/client/markdown-dom.test.ts`.
- Given a backslash followed by a non-punctuation character (e.g. `\n` as literal text, not a newline), when parsed, then the backslash is left as a literal character rather than being consumed — standard Markdown escaping only applies to ASCII punctuation.

## Functional Requirements

- `src/markdown/index.ts` `parseInline`: a new backslash-escape check runs first in the character loop — `\` followed by one of CommonMark's escapable ASCII punctuation characters emits that character literally and advances past both; any other backslash is left untouched as a literal character.

## Assumptions

- Scope is standard Markdown punctuation escaping (CommonMark's escapable set), not a general C-style escape sequence system (no `\n`, `\t`, etc. as control characters).

## Risks

- None identified; escaping only intercepts backslash-punctuation pairs, existing non-escaped emphasis/strong/code/link parsing is unaffected (verified via existing 92 unit tests in `src/markdown/index.test.ts` plus new fixture, all green).

## Open Questions

## Notes

### 2026-07-19 — implementation

Added an `ESCAPABLE_RE`-gated backslash-escape branch at the top of `parseInline`'s main
loop in `src/markdown/index.ts`: `\` followed by ASCII punctuation emits the punctuation
literally and drops the backslash; anything else leaves the backslash as literal text. Runs
before all other inline-syntax checks so `\*` never gets a chance to be read as an emphasis
delimiter. Verified: `bun run typecheck`, `bun run test:coverage` (100% lines on all changed
files), `bun run e2e` all green. `bun run lint` fails independent of these changes
(pre-existing biome config error, confirmed via `git stash`).
