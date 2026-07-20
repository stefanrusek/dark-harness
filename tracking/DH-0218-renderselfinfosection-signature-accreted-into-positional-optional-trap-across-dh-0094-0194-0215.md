---
spile: ticket
id: DH-0218
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0215, DH-0216]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0218: renderSelfInfoSection signature accreted into positional-optional trap across DH-0094/0194/0215

## Summary

renderSelfInfoSection now takes a defaulted buildInfo plus three trailing optionals that must always travel together; the sole production caller passes an undefined placeholder to skip buildInfo. Bundle sessionId/agentId/logFilePath into one optional object so the all-or-nothing invariant is type-enforced.

Detail: `renderSelfInfoSection(config, model, buildInfo = BUILD_INFO, sessionId?, agentId?,
logFilePath?)` (`src/prompt/system-prompt.ts`) grew this shape by accretion — DH-0094 added
`config`/`model`/`buildInfo`, DH-0215 appended `sessionId`/`agentId`/`logFilePath`. Two smells
result:

1. The sole production caller (`AgentRuntime.buildAgentSystemPrompt`,
   `src/agent/runtime.ts:397`) must pass `undefined` as a positional placeholder for
   `buildInfo` just to reach the three trailing args it actually wants — the classic
   defaulted-param-in-the-middle trap.
2. The three trailing optionals are not independent: the function body only renders the
   session/agent/log block when **all three** are defined (`if (sessionId !== undefined &&
   agentId !== undefined && logFilePath !== undefined)`). That all-or-nothing invariant is
   enforced at runtime rather than by the type — nothing stops a caller passing two of three.

## User Stories

### As a maintainer calling renderSelfInfoSection, I want the self-identity fields typed as one unit

- Given the session/agent/log fields only make sense together, when I call the function with a
  partial subset (e.g. sessionId but no logFilePath), then the type checker rejects it rather
  than the function silently omitting the block at runtime.

### As the production caller, I want to supply build info by name, not by positional placeholder

- Given I want to pass the self-identity object but keep the default `buildInfo`, when I call
  the function, then I do not have to pass an explicit `undefined` placeholder for a parameter
  I am not overriding.

## Functional Requirements

- Refactor `renderSelfInfoSection` to bundle `sessionId`/`agentId`/`logFilePath` into a single
  optional object parameter (e.g. `self?: { sessionId; agentId; logFilePath }`), so the
  all-or-nothing invariant is expressed in the type.
- Remove the need for the `undefined` `buildInfo` placeholder at the `runtime.ts` call site
  (e.g. move `buildInfo` into an options object, or reorder so defaulted params trail the
  bundled self-object — implementer's call, guided by the existing test shapes).
- Update the sole production caller and all `system-prompt.test.ts` cases; preserve 100%
  coverage. No behavioral change to the rendered prompt text.

## Assumptions

- `renderJobModeSection` (adjacent, DH-0194) takes no args and is unaffected — this ticket is
  scoped to `renderSelfInfoSection` only.

## Risks

- Purely mechanical; the only risk is churn in `system-prompt.test.ts`. No runtime behavior
  changes, so e2e is unaffected.

## Open Questions

- None material — options-object vs. reorder is an implementer style choice within Prompt's
  own domain.

## Notes

- Owner: **Prompt** (Iris) — `renderSelfInfoSection` lives in `src/prompt/system-prompt.ts`.
  The single call site in `src/agent/runtime.ts` (Core/Grace) will need a trivial companion
  edit; coordinate the two-line change rather than treating it as a cross-domain handoff.
- Small cleanup, low priority. Filed by Fable during refactoring round DH-0216.
- **2026-07-19 (implemented, coordinator-reconciled):** the dispatched implementer's worktree
  predated DH-0215, so it scoped its own pass to just bundling `buildInfo` into
  `SelfInfoOptions`. The coordinator then merged that onto current HEAD (which does have
  DH-0215's `sessionId`/`agentId`/`logFilePath` fields) and extended `SelfInfoOptions` with
  those three per this ticket's own Functional Requirements — exactly the reconciliation the
  implementer's own notes anticipated. Final signature:
  `renderSelfInfoSection(config: DhConfig, model: ModelConfig, options: SelfInfoOptions = {})`
  with `SelfInfoOptions = { buildInfo?: BuildInfo; sessionId?: string; agentId?: string;
  logFilePath?: string }`. Sole production call site
  (`AgentRuntime.buildAgentSystemPrompt`, `src/agent/runtime.ts`) updated to pass a single
  options object instead of positional args. All four quality gates confirmed green on the
  merged result.
