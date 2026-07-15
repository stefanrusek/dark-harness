---
spile: ticket
id: DH-0015
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-15
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0015: Several `dh.json` config-loading edge cases are unhandled or under-validated

## Summary

A cluster of related config-loading gaps, all in `src/config/`: `$(VAR)` interpolation
(`interpolate.ts`) has no escape mechanism, so a literal `$(...)`-shaped string (e.g. meant for a
subprocess, not for `dh` itself) is always either interpolated or errors if the referenced env var
is unset; `validateProvider`/`validateMcpServers` (`validate.ts`) spread unknown keys through
unchecked, unlike the strict top-level allowlist — a typo'd key inside a `provider` or
`mcpServers` entry (e.g. `apiKye`) is silently accepted and the intended field silently
`undefined`, defeating the file's own stated "catch config typos early" goal; and `--env` file
parsing (`src/cli.ts`) has no escape-sequence handling, no single-quote support, and doesn't treat
`#` as a comment marker the way common dotenv tooling does, so a value containing `#` is silently
included differently than an operator would expect.

## User Stories

### As an operator, I want a typo'd key inside a `provider`/`mcpServers` entry to be caught at load time, not silently ignored

- Given a `provider[]` or `mcpServers` entry with an unrecognized key, when config loads, then it
  is rejected or warned on, matching the top-level key-allowlist behavior already in place.

### As an operator, I want to express a literal `$(...)`-shaped string in config without it being treated as an env reference

- Given a `$$(...)` escape (or similar convention), when interpolation runs, then it resolves to
  the literal `$(...)` text rather than looking up an env var.

## Functional Requirements

- Given the `--env` file format, when documented, then its exact (deliberately minimal) supported
  dotenv subset is stated in `--help`/README so operators aren't surprised by comment/quoting
  behavior that differs from common dotenv tools.

## Notes

> [!NOTE]
> Source: Core domain sweep findings #9, #10, #11.
