---
spile: ticket
id: DH-0032
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

# DH-0032: Windows and macOS release binaries are cross-compiled but never actually executed anywhere, and the e2e-tested binary isn't the same artifact as what ships

## Summary

All 5 release targets are cross-compiled from a single `ubuntu-latest` runner
(`.github/workflows/release.yml`); the entire e2e suite (`gate.yml`) also runs only on
`ubuntu-latest`, and the PTY-based TUI tests depend on `tmux`, a Linux-only tool. This means the
windows-x64 binary is built and shipped in every release with **zero** execution anywhere in CI —
a broken cross-compile (wrong syscalls, path separators, bun-windows quirks) would never be
caught. The darwin-x64/darwin-arm64 binaries are equally never run on real macOS. Compounding
this: `e2e/support/build.ts` builds a native-host binary for e2e (no `--target`), while
`release.yml` builds with `--target ${{ matrix.target }}` — even for linux-x64, the e2e gate
never actually exercises the *specific artifact* that gets released; it exercises a build with the
same script and stamping logic, but a different invocation. A cross-compilation-specific bug would
not be caught by e2e at all, only by the compiler not erroring at build time.

## User Stories

### As a user on Windows or macOS, I want some confidence the binary I download actually runs before it ships

- Given a tagged release, when the pipeline builds cross-compiled binaries, then at least a smoke
  test (e.g. `dh --version`) runs on a real runner of each target OS before the release is
  finalized.

## Functional Requirements

- Given the eventual fix, when e2e or a release-smoke-test step is added, then it exercises the
  actual artifact intended for release, not a separately-built native-host binary.

## Notes

> [!NOTE]
> Source: CI/Release/E2E sweep findings #15, #16, #17.
