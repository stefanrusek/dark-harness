---
spile: ticket
id: DH-0241
type: feature
status: refining
owner: Coordinator
resolution:
blocked_by: []
created: 2026-07-20
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0241: Refactoring round 3 (closing round of 3): verify DH-0240 clean, broadened full-repo sweep

## Summary

Round 3 of the owner's 3-round refactoring cycle. Verify round-2's DH-0240 fix landed clean and do a broadened full-repo drift sweep.

This is the closing round of the explicit 3-round cycle the owner requested (round 1 = DH-0235,
round 2 = DH-0239). Unlike rounds 1-2 (scoped tightly to the PR#10 wave's blast radius plus the
DH-0229-0234 live-testing fixes), this round broadened the lens to a fresh full-repo sweep.

## Part 1 — verify DH-0240 landed clean

Verified. Commit `3ef0e79`:
- The unused `resourceMetadataUrl?` field is gone from `StoredMcpAuth` — zero references remain.
- The unreachable `alreadyAuthenticated: true` on the `client_credentials` begin return (`manager.ts:335-338`) is removed; the client_credentials branch in `mcp-auth.ts:78` returns before the `if (result.alreadyAuthenticated)` check at line 84, confirming the original dead-code analysis.
- The *live* `alreadyAuthenticated: true` on the `authorization_code`/AUTHORIZED return (`manager.ts:354`) and the `McpAuthBeginResult.alreadyAuthenticated?` field (`manager.ts:54`) are correctly untouched and still exercised.
- `typecheck` and `lint` (biome, 417 files) both clean.

No stray references, no test/doc drift. DH-0240 is clean.

## Part 2 — broadened full-repo sweep

Coverage (no silent truncation, §8): read `mcp-auth.ts`/`manager.ts` in full; ran repo-wide
greps for TODO/FIXME/@ts-ignore, empty catch blocks, stub bodies, console usage, stale brand
(figlet/diamond) refs, cost-format duplication, and local wire-type redeclaration; dispatched a
read-only cross-domain drift sweep (all of `src/`) covering duplicated logic, dead exports,
naming drift, half-finished work, and ADR/doc-citation hygiene. Typecheck + lint run as sanity
(not the full gate — refactoring rounds don't run implementation gates).

### Filed

- **DH-0242** (bug, Coordinator) — CLAUDE.md §4 invariant citations point at stale ADR
  filenames/numbers after the ADR set was renumbered (a `0003-client-side-web-ui.md` insert
  shifted everything after it). 5 of 6 §4 ADR pointers now resolve to the wrong file or a
  non-existent filename; §3's "ADR 0005's amendment" build-identity pointer is stale too.
  Load-bearing (the constitution is what agents are told to consult). Pure citation hygiene,
  not an invariant change — routine Coordinator ticket, not a §6 escalation.
- **DH-0243** (bug, Core) — dead `CLI_RESET` export in `src/cli/styling.ts:33`; zero consumers,
  and its own justifying comment (help.ts composes it) is stale — help.ts no longer references it.
- **DH-0244** (bug, TUI) — byte-identical `clearCiEnvForInteractiveInkRender()` copy-pasted
  across `render-interactive-in-tests.ts` and `clear-ci-env-for-interactive-render.ts`; the two
  side-effect entrypoints are legitimately needed, but the shared clearing body should be
  imported from one module, not duplicated (drift-prone).

### Considered and deliberately NOT filed

- **Cost-format precision drift** (`log-analysis.ts:186`, `session-budget.ts:72`,
  `activity-feed.ts:95` hand-roll `$…toFixed(4)` vs the shared `formatCostUsd`'s `$X.XX` at
  `format.ts:48`): the 4-decimal precision is plausibly deliberate for diagnostic surfaces
  (budget/log/activity) vs 2-decimal for headline display. Folding them together would require a
  second precision variant and is closer to speculative helper-building than fixing a defect —
  not filed, to avoid manufacturing a finding. Noted here in case the coordinator wants a
  shared 4dp helper later.
- **MCP auth façade naming** (`ctx.mcpAuth.status/begin/complete` → manager
  `authStatus/beginAuth/completeAuth`): already noted as an optional co-located tweak in DH-0239;
  it's an intentional adapter façade, not drift. Not worth a standalone ticket.
- **Loop constants** `STOPPED_WHILE_WAITING_REASON`/`COMPACTION_SUMMARY_REQUEST` exported but
  used only within `loop.ts`: trivially low value; not filed.
- **Empty catch blocks / "not implemented" comments**: all reference existing open tickets
  (DH-0012, DH-0019) or are benign cleanup-swallows — nothing new.
- **ADR 0009 collision (DH-0238)**: confirmed resolved — workflow ADR is now `0010`, DH-0238 at
  `verifying`. Not reopened.

### Escalation

Nothing tripped a §6 trigger. DH-0242 touches CLAUDE.md (project law) but only re-points broken
ADR citations at files that already exist — it changes no invariant wording — so it is a routine
Coordinator ticket, not an architect escalation.

## Outcome

Rounds 1-2's fixes held; DH-0240 clean. Three real cleanup tickets filed (DH-0242/0243/0244),
all small and cleanly single-domain. This closes the owner's 3-round cycle.

## Notes

No product code touched this round (refactoring rounds produce tickets only). Round filed by
Fable, architect-on-call.
