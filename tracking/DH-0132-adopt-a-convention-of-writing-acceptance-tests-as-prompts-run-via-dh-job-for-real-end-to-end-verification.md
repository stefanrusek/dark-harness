---
spile: ticket
id: DH-0132
type: feature
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-17
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0132: Adopt a convention of writing acceptance tests as prompts run via dh --job for real end-to-end verification

## Summary

Owner observation 2026-07-17, prompted by watching a haiku-model sub-agent successfully read and verify a batch of tickets tonight: it's clear this project should be writing some of its acceptance tests as literal prompts sent to a real dh instance via the existing headless dh --job / --json + exit-code mechanism, rather than only unit/integration tests in the traditional sense. This is a process/tooling convention, not a single bug fix -- likely belongs alongside CLAUDE.md 9's existing unit/integration test-tier language as a third tier, or as a documented pattern + example harness script under tracking/ or a new skill. Needs the owner's/Fable's input on scope (is this a new formal test tier, a supplementary verification technique, or specifically tied to the gate-check skill from DH-0113) before it's actionable as a normal implementation ticket.

**Owner decision (2026-07-19):** build a first real example before deciding whether this
becomes a formal test tier, a supplementary technique, or a DH-0113 gate-check extension —
"build it first then we'll see how useful it is." Scope this ticket to a prototype, not a
CLAUDE.md §9 rule change: pick one real acceptance criterion from an existing or upcoming
ticket that's naturally suited to end-to-end prompt verification (a multi-step behavior a
unit test can't easily exercise — a good candidate is something already in `--job` scope,
e.g. verifying a CLI flag's full behavior against a real compiled binary + mock provider),
write it as a literal prompt run via `dh --job --json`, and land it as a documented example
(a script under `tracking/` or a small skill, per the Summary's own framing) other tickets
can point to. Re-open the tier-vs-technique question once this prototype exists and its
real usefulness is visible.

## User Stories

### As a ticket author, I want a working example of a `dh --job` acceptance-test prompt, so future tickets can decide whether to adopt the pattern based on a real precedent rather than a hypothetical

- Given one real acceptance criterion picked from an existing ticket, when it's rewritten as
  a `dh --job --json` prompt against a real compiled binary, then it runs, exits with the
  correct code, and its JSON output demonstrates the criterion was actually verified end to
  end (not just that the process didn't crash).
  - Proven by: `tracking/DH-0132-.../dh-job-acceptance-example.web-port-host.ts`, run
    directly (`bun run` — see file header for the exact invocation). Not a `bun:test` case;
    the script itself is the executable proof, invoked and observed as part of this ticket's
    close-out (see Notes below for the two real outcomes it produced).

## Functional Requirements

- Pick one real, concrete acceptance criterion to prototype against (implementer's call,
  informed by what's currently open/relevant).
- Write it as a `dh --job --json` prompt/script, documented well enough that another ticket
  author could copy the pattern.
- Do NOT touch CLAUDE.md §9 or propose a formal tier in this pass — that's an explicit
  follow-up decision, not part of this ticket's scope.

## Assumptions

- A single well-chosen example is more useful right now than a general-purpose harness —
  don't over-build before the pattern's real usefulness is known.

## Risks

- Low — this is additive tooling/documentation, no product code changes implied.

## Open Questions

- Formal-tier-vs-technique decision — deliberately deferred until after this prototype
  exists (see owner decision above).

## Notes

> [!NOTE]
> **DH-0132 implementation (2026-07-19).** Built the prototype:
> `tracking/DH-0132-.../dh-job-acceptance-example.web-port-host.ts` (+ sidecar `README.md`
> documenting the pattern for future ticket authors).
>
> Criterion chosen: the composed DH-0168 (`--web-port <N>`)/DH-0182 (`--host <name>`)
> behavior — `dh --web --web-port <N> --host 127.0.0.1` must actually bind its web UI static
> server to exactly `127.0.0.1:<N>`. Picked because it's genuinely end-to-end (a real OS bind
> call) and, as of this writing, has no coverage anywhere in `e2e/` (checked — no test greps
> for `web-port`/`--host` binding).
>
> The script runs a real `dh --instructions <file> --job --json` process (real compiled
> binary, `e2e/support/build.ts`'s `ensureBuilt()`) against a small custom mock Anthropic
> provider (deliberately not the shared, purely-positional `e2e/support/mock-provider.ts`):
> turn 1 always asks the model to run one foreground (`run_in_background: false`) `Bash` tool
> call that spawns a *child* `dh --web --web-port --host` process, curls it for real, and
> exits 0/1 with a `VERIFIED`/`FAILED` marker; turn 2 inspects the real `tool_result.is_error`
> from that call and only emits `ReportOutcome(success)` if the real check passed. That makes
> the outer job's exit code and `--json` `job_result.success` genuine proof, not a hardcoded
> outcome — verified both directions while building it: against a checkout with DH-0168/
> DH-0182 present (this ticket's own final branch state) the script produces `job_result.
> success: true`, exit 0, and a real `web UI ready at http://127.0.0.1:47591.` line in the
> child's log; against an older checkout predating those two tickets (used only for the
> negative-control check, not landed here) it produces `job_result.success: false`, exit 1,
> and a real `dh: unknown flag: --web-port` line — same script, same prompt, opposite outcome,
> tracking the real CLI behavior.
>
> Quality gates run: `bun run typecheck` (clean) and `bun run lint` (clean, one Biome
> auto-format applied). `bun run test:coverage`/`bun run e2e` not run against this
> change — it's a standalone example script under `tracking/`, not product source or an
> addition to the `e2e/` suite (per this ticket's own scope: "don't over-build", no
> CLAUDE.md §9 change). The script itself was executed directly (`bun run tracking/DH-0132-
> .../dh-job-acceptance-example.web-port-host.ts`) as its own verification, twice, both
> producing the expected real PASS.
>
> Formal-tier-vs-technique decision remains open per the owner's framing — this ticket only
> delivers the precedent to evaluate that against.
