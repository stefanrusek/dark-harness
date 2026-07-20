---
spile: ticket
id: DH-0242
type: bug
status: refining
owner: Coordinator
resolution:
blocked_by: []
created: 2026-07-20
relations:
  depends_on: []
  relates_to: [DH-0241]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0242: CLAUDE.md section 4 invariant citations point at stale ADR filenames/numbers after ADR renumbering

## Summary

The ADR set was renumbered at some point (a `0003-client-side-web-ui.md` was inserted,
shifting every later ADR down by one), but CLAUDE.md's §4 invariant citations were never
updated to match. Five of the six ADR pointers in §4 now resolve to the wrong file or a
non-existent filename. CLAUDE.md is the project's binding law — every agent is told to
consult these ADRs — so a broken citation sends readers to the wrong decision or a 404.
Found during refactoring round 3 (DH-0241).

Actual `docs/adr/` files today:
```
0001-single-binary-multi-mode.md
0002-http-sse-protocol.md
0003-client-side-web-ui.md
0004-security-posture.md
0005-jsonl-per-agent-logging.md
0006-exit-code-contract.md
0007-dhjson-schema.md
0008-coverage-and-e2e-gates.md
0009-markdown-colored-span-subset.md
0010-workflow-scripts-vs-ad-hoc-agents.md
```

Stale citations in CLAUDE.md:

| Location | Cited | Actual file |
| --- | --- | --- |
| §4.1 | `adr/0001-single-binary-modes.md` | `0001-single-binary-multi-mode.md` (filename wrong) |
| §4.3 (and §4.7) | `adr/0003-security-posture.md` | `0004-security-posture.md` (0003 is now client-side-web-ui) |
| §4.4 | `adr/0004-jsonl-logging.md` | `0005-jsonl-per-agent-logging.md` |
| §4.5 | `adr/0005-exit-code-contract.md` | `0006-exit-code-contract.md` |
| §4.6 | `adr/0006-dhjson-schema.md` | `0007-dhjson-schema.md` |

Additionally, §3's ownership table refers to "ADR 0005's amendment" for build-identity
stamping in `scripts/build.ts`; ADR 0005 is now JSONL logging, so that pointer is stale too
and must be re-resolved to whichever ADR actually carries the build-identity amendment.

This is a pure documentation-hygiene fix: it re-points citations at the ADRs that already
exist. It does **not** change, bend, or relitigate any invariant — the decisions themselves
are untouched — so it is a routine Coordinator ticket, not a §6 architect escalation.

## User Stories

### As an agent consulting CLAUDE.md, I want its ADR citations to resolve to the real files

- Given CLAUDE.md §4.1, when I follow the ADR pointer, then it names `0001-single-binary-multi-mode.md` (the file that exists).
- Given CLAUDE.md §4.3, when I follow the security-posture pointer, then it resolves to `0004-security-posture.md`, not `0003` (which is client-side-web-ui).
- Given CLAUDE.md §4.4/§4.5/§4.6, when I follow each pointer, then they resolve to `0005-jsonl-per-agent-logging.md`, `0006-exit-code-contract.md`, and `0007-dhjson-schema.md` respectively.
- Given CLAUDE.md §3's "ADR 0005's amendment" reference, when I follow it, then it points at the ADR that actually carries the build-identity stamping amendment.

## Functional Requirements

- Update the five stale §4 ADR citations (and any duplicate elsewhere in the file, e.g. §4.7's second `0003-security-posture.md`) to the correct current filenames.
- Re-resolve and fix §3's "ADR 0005's amendment" build-identity pointer.
- Verify no other ADR citation across the repo's docs (README, handoffs, roster) is stale by the same renumbering; fix or note any found.

## Assumptions

- The ADR *content* is correct where it lives; only CLAUDE.md's pointers are wrong.

## Risks

- Editing CLAUDE.md is editing project law; keep the diff strictly to citation strings — no invariant wording changes.

## Open Questions

- Which ADR now carries the build-identity stamping amendment referenced as "ADR 0005's amendment"? (Was likely the pre-renumber 0005 = exit-code-contract, or the logging ADR — implementer must confirm against actual ADR bodies.)

## Notes

Filed by Fable during refactoring round 3 (DH-0241).
