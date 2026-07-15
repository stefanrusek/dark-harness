# ADR 0008: 100% coverage + real-binary e2e as hard gates

**Status:** Accepted

## Context

The fleet model (METHODOLOGY.md) depends on trusting cheap-tier implementer output without
re-reading every line — that only works if "done" is machine-checkable. Dark Harness also
has three UI surfaces (console TUI, web UI, headless server) plus a client↔server protocol,
where unit tests alone would miss real integration failures (PTY rendering, SSE framing
across an actual process boundary, binary compilation itself).

## Decision

- **100% code coverage is a gate, not a target.** CI fails below it, for new/changed code
  in every PR.
- **Full end-to-end tests spawn the real compiled binary** in each run mode and drive it:
  - A **PTY harness** for the TUI.
  - A **headless browser** for the web UI.
  - **Real client↔server** over HTTP/SSE across actual processes (not in-process mocks).
  - The model sits behind a **mock provider endpoint** (an Anthropic-compatible local
    server) so e2e runs are deterministic and free.
  - Real-API smoke tests are optional and manual — never part of the gate.
- Standard hygiene gates besides: typecheck, lint/format (exact commands in CLAUDE.md §5).

## Consequences

- Every domain's handoff must include its slice of the e2e matrix, not just unit tests.
- The mock provider endpoint is itself a build artifact (owned by `e2e/` or `src/agent/`
  provider-adapter tests) and must speak the real Anthropic wire format closely enough that
  swapping in a real key is a config change, not a code change.
- Coverage tooling and thresholds are enforced in CI (`.github/workflows/`) exactly as
  documented in CLAUDE.md — no local-only enforcement.
