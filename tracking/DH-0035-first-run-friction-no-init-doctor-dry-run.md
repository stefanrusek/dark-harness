---
spile: ticket
id: DH-0035
type: feature
status: implementing
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

# DH-0035: No `dh init`/`dh doctor`/`--dry-run`, and cold error messages give a first-time operator no path forward

## Summary

A cluster of first-run-friction findings from the dark-factory ops audit: there is no scaffold
command to generate a starter `dh.json` (an operator must hand-author one from prose docs alone);
with no `dh.json` present, `loadConfig` throws a terse "config file not found: dh.json" with no
pointer to `--config`, no sample, no README link; there is no lightweight `dh doctor`/`--check`
mode that pings each configured provider/model once without spending a full agent turn, so
credential/model-access problems are only discovered by running a real (possibly costly) job; and
there is no `--dry-run` that validates config + instructions file + provider client construction
without actually invoking the model — all three would materially reduce the trial-and-error loop
of getting a first `dh.json` working, especially before committing to an unattended `--job` run.

## User Stories

### As a first-time operator, I want a command that scaffolds a working `dh.json` for me

- Given no existing config, when `dh init` (or similar) is run, then a minimal, valid `dh.json`
  matching README's sample is written to the working directory.

### As an operator, I want a cheap way to verify my config/credentials work before running a real job

- Given a configured model/provider, when `dh doctor`/`--check` is run, then it performs one
  no-op provider call per configured model and reports pass/fail, without spending a full turn.

### As an operator integrating `dh --job` into an orchestrator, I want to validate the whole invocation without spending tokens

- Given `--dry-run`, when passed alongside the normal flags, then config/instructions/provider
  setup is validated and the process exits 0 without ever calling the model.

## Notes

> [!NOTE]
> Source: dark-factory ops audit findings #1, #2, #4, #18.
