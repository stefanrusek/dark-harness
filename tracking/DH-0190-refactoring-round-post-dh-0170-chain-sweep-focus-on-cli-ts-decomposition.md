---
spile: ticket
id: DH-0190
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0190: Refactoring round: post-DH-0170-chain sweep, focus on cli.ts decomposition

## Summary

Second refactoring round (DH-0141 mechanism). Scoped to commits since the last Refactoring-Round trailer (DH-0169's closing commit), covering the whole DH-0170 client-core decomposition chain (DH-0183-0186), DH-0171/0172/0173/0176/0177/0178/0179/0180/0181, DH-0168/0182 (host/port flags), and DH-0187/0188/0189 (--import feature). Owner has explicitly asked this round give extra attention to src/cli.ts (2041 LOC pre-this-round, most-churned file in the repo per DH-0169's findings) as a standing priority, not just a routine finding among others: decomposing it would help readability, churn (it is the file that changes most often, so it is a merge-conflict/review hotspot), editability, and testability. DH-0174 (split cli.ts + extract shared ANSI primitive, filed in the first round) should be reviewed for whether its scope is still accurate/current after this round's changes (DH-0168/0182/0189 all added new cli.ts flag-parsing code) and extended if further decomposition opportunities are found beyond what it already captures.

## Round close-out (Fable, 2026-07-19)

This is a refactoring-round tracking ticket, not a feature — no User Stories / acceptance
criteria of its own. Deliverable is new/updated tickets. Do not add the `Refactoring-Round:
DH-0190` trailer commit here — that is the coordinator's (Ada's) call, same as DH-0169.

### What was reviewed

Sentinel `git log --grep='^Refactoring-Round: DH-[0-9]\+' -1` resolved to `9cd3ea0`
("Refactoring-Round: DH-0169") — so, unlike the first round, this round *did* have a clean
prior sentinel. Reviewed the commit range `9cd3ea0..HEAD` (31 commits):

- **Read in full:** current `src/cli.ts` (2297 lines, end to end) — the owner-directed focus.
- **Diff-reviewed / structurally inspected:** the client-core decomposition chain
  (DH-0183/0184/0185/0186 — `src/client-core/` SSE transport + slash-command + connection
  status), DH-0173 (AgentRuntime split), DH-0171/0172 (provider-adapter + tool-input-validation
  helper consolidation), DH-0181 (shared tree-connector prefix → `src/contracts/tree-connector
  .ts`), DH-0176/0177/0180 (test-support cleanup, fake-agent-loop relocation), DH-0179 (web
  static-server), DH-0168/0182 + DH-0189 (the new cli.ts flag code), DH-0188 (`src/server/
  import-claude-session.ts`, 671 new lines). Cross-checked the ANSI/status-color duplication
  landscape (`design-tokens.ts` vs. cli.ts / log-analysis.ts / tui/ink/tokens.ts).

### Coverage caveat (CLAUDE.md §8, no silent truncation)

`import-claude-session.ts` (671 lines) was inspected at the function-boundary level, not
line-by-line; its `translateAgentLines` (~197 lines) is on the large side but is a single
cohesive translation routine with well-factored helpers, and I judged it not worth a ticket.
The client-core chain and the DH-0173 AgentRuntime split were reviewed via diffstat + spot
reads, not exhaustive line review — both landed clean (fine-grained modules, real tests, no
TODOs). `grep -rn 'TODO|FIXME|HACK|XXX' src/ --include='*.ts'` over non-test source returned
**zero** — no leftover-marker findings this round. The work merged since DH-0169 is, on the
whole, genuinely tidy; this round is deliberately light on findings as a result.

### Tickets filed / updated

- **DH-0174 (updated, Core)** — cli.ts split. Added a full scope-refresh (2041→2297 LOC; the
  DH-0168/0182/0189 flag churn reinforces the premise) and a **concrete 11-module decomposition
  plan** (`src/cli/{styling,args,help,env-file,import-source,activity-feed,doctor,init,
  agent-loop-adapter,deps,run}.ts` + a slimmed `main`/barrel), with exact current line ranges,
  a test-neutrality constraint (barrel re-exports so no test rewrites under the 100% gate),
  leaf-first landing order, and cycle-avoidance notes. **This is the cli.ts decomposition plan
  the round was asked to produce — it lives in DH-0174, not here.** Also split the cross-domain
  ANSI sub-item out to DH-0191 and rescoped DH-0174 to single-domain (Core).
- **DH-0191 (new, cross-domain — flag for coordinator triage)** — consolidate the two remaining
  hand-rolled five-status SGR maps (`cli.ts` `CLI_STATUS_COLOR`, `log-analysis.ts`
  `STATUS_COLOR`) onto `src/design-tokens.ts`'s `STATUS_TOKENS[].sgr` (which post-dates DH-0174
  and already is the canonical table), and extract the still-duplicated generic SGR helpers
  (colorize/dim/bold/reset) shared by cli.ts and tui/ink/tokens.ts. Reframes DH-0174's old ANSI
  sub-item around the shared module that now exists. Not a §6 escalation (SGR bytes are
  presentation, not `src/contracts/` wire truth) but genuinely spans Core+Server+TUI, so it
  needs coordinator slicing.

### Explicitly considered and NOT filed

- **`import-claude-session.ts` size / `translateAgentLines` length** — cohesive, well-factored,
  fully tested; splitting would be churn for its own sake. No ticket.
- **`web/server.ts` loopback self-proxy + `as unknown as Response` casts** — these are the
  *intended* DH-0179 outcome (that ticket closed `done` having deliberately kept the self-proxy
  and split the any-casts down to two documented `as unknown` bridges). Not a regression. No
  ticket.
- **The two markdown-rendering `RESET` constants** (`tui/markdown-ansi.ts`,
  `markdown/rendering-fixtures.ts`) — noted inside DH-0191's Open Questions as possibly-in-scope
  rather than as their own ticket; they're a distinct concern (markdown SGR, not status color).
- **DH-0175** (TASK_FAILED text-marker) — already open at `refining` with a full architect
  hold; nothing to add this round.

## Notes

Round mechanism: DH-0141. Predecessor round: DH-0169.
