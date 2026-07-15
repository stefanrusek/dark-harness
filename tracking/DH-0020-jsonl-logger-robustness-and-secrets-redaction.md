---
spile: ticket
id: DH-0020
type: bug
status: draft
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

# DH-0020: JSONL logger has no write-error handling, no fsync, and no awareness of secrets in tool call I/O

## Summary

`src/server/logger.ts`'s `appendFileSync` call has no try/catch — on disk-full (ENOSPC),
permission error, or path issues, this throws synchronously inside the `onLog` callback invoked
directly from the agent loop's event emission, which could crash the whole `dh` process (the
opposite of ADR 0005's crash-tolerance intent: the log write failing shouldn't be what kills the
run it's supposed to make diagnosable). Separately, there is no `fsync`/flush after
`appendFileSync`, so the doc comment's claim that "at most the very last write can be lost" is only
true for a process crash, not a full host crash/power loss — the guarantee is overstated. Most
significantly: `SessionLogger.append` writes whatever `LogLine` it's given verbatim, with zero
filtering of `LogToolCallEvent.input`/`LogToolResultEvent.output` for secrets — provider API keys,
credentials a Bash command handles, or MCP server headers can land in the JSONL log unredacted,
and that log is downloadable over HTTP (gated only by the optional bearer token, or not gated at
all in the plaintext default).

## User Stories

### As an operator, I want a log-write failure to not crash the session it's trying to make diagnosable

- Given a disk-full or permission error during a log write, when it occurs, then the harness
  degrades gracefully (drops that line, surfaces to stderr) rather than crashing the agent loop.

### As an operator, I want secrets that pass through tool calls to not land in a downloadable log file unredacted

- Given a tool call's input/output containing something that looks like a secret (API key pattern,
  `Authorization` header value), when it's logged, then it is redacted before being written.

## Functional Requirements

- Given the durability guarantee in the logger's doc comment, when documented, then its scope
  (process-crash-safe, not host-crash-safe) is stated accurately, or fsync is added if the stronger
  guarantee is actually required.

## Notes

> [!NOTE]
> Source: Server domain sweep findings #5, #6, #8. Finding #8 overlaps with the security audit's
> finding #13 (provider error messages could leak diagnostic detail) and finding #18 (Bash env
> inheritance) — see **DH-0040** for the Bash/provider-error-message side of the same secrets-
> hygiene theme; this ticket is specifically about the logger's own redaction responsibility.
