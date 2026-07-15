---
spile: ticket
id: DH-0030
type: bug
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

# DH-0030: CI's coverage/completeness/e2e gates rely on fragile text-parsing and a fail-open conditional, not structured checks

## Summary

`.github/workflows/gate.yml`'s coverage gate `grep`s `bun test --coverage`'s printed summary line
and string-compares `"100.00"` — any bun version bump that changes the text format (spacing,
column order, locale decimal separator) could silently break the check. The companion
completeness step (diffing `git ls-files` against files bun's coverage table reports on) uses an
`awk`/`comm` heuristic on the same printed table, and only checks `src/*.ts`, never `e2e/` or
`scripts/`. Separately, the e2e step only runs `bun run e2e` if it auto-detects test files under
`e2e/` via a glob — currently populated so this is not live-broken, but it fails *open*, not
closed: if a future change accidentally emptied `e2e/` of test files, the gate would silently
downgrade to a notice instead of failing, rather than asserting "e2e must have at least N test
files." Also, CLAUDE.md §5's stated coverage scope ("new/changed code") doesn't match what the
gate actually enforces (100% for the entire repository, always) — stricter in practice than
documented, worth reconciling the wording either way.

## User Stories

### As a maintainer, I want the coverage gate to survive a `bun` version bump without silently breaking

- Given a `bun test --coverage` output-format change, when CI runs, then the gate uses a
  structured data source (e.g. `--coverage-reporter=lcov`/json) rather than parsing the printed
  ANSI table, or `bunfig.toml`'s `coverageThreshold` if ownership allows.

### As a maintainer, I want the e2e gate to fail closed if e2e coverage is ever accidentally emptied

- Given zero e2e test files are detected, when CI runs, then the gate fails outright (once e2e is
  established as populated, which it is today) rather than downgrading to a notice.

## Notes

> [!NOTE]
> Source: CI/Release/E2E sweep findings #1, #2, #3, #32.
