---
spile: ticket
id: DH-0169
type: bug
status: closed
owner: stefan
resolution: done
blocked_by: []
created: 2026-07-18
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0169: Refactoring round: first-ever full-history sweep

## Summary

First refactoring round ever formally closed (DH-0141 mechanism) — no prior Refactoring-Round: trailer commit exists anywhere in history, confirmed by 'git log --all --grep=Refactoring-Round:' returning zero results. This round therefore reviews the full commit history (~630 commits), not just the delta since a prior round. Owner explicitly asked for extra thoroughness given this backlog: go deeper than a routine round would, across the full ownership map (CLAUDE.md section 3), not just recent surface-level churn. Findings land as new draft/refining tickets per the standard docs/design/refactoring-round-prompt.md process; this ticket tracks the round itself (what was reviewed, what was filed, what was explicitly skipped).

## Notes

### Round summary (Fable, 2026-07-18)

**Scope covered.** First-ever formal round, so the full history (632 commits, `Initial
commit` → HEAD) was in scope rather than a delta. Coverage strategy across the ownership map:

- **Sampled deeply (read-level):** provider adapters `anthropic.ts`/`bedrock.ts` (compared
  line-by-line); the todo/resolve-task tool family + `tools/types.type.ts`; both SSE clients
  (`tui/sse-parser.ts`+`sse-client.ts`, `web/client/sse.ts`); both state reducers
  (`tui/state.ts`, `web/client/state.ts`); both slash-command parsers; `web/server.ts`;
  `server/fake-agent-loop.ts`; `server/log-analysis.ts` + `tui/tree.ts`; both mock providers
  and the `e2e/spikes/*/support.ts` + `explore-design-review.ts`; all three CI workflows;
  `src/prompt/system-prompt.ts`/`skills.ts`; `scripts/build.ts`. Structure (not every line)
  of the two God files `cli.ts` (2041 LOC) and `runtime.ts`/`loop.ts`.
- **Corroborated with repo metrics:** file-size and churn analysis (`cli.ts` = largest +
  most-churned at 49 revisions; `runtime.ts` 2nd; parallel `tui/state.ts` ↔
  `web/client/state.ts` churn confirming the client-duplication finding). Grepped all
  domains for `TODO/FIXME/HACK/@ts-ignore/biome-ignore`. Read roster memory files for
  recorded open threads.
- **Sampled by signature/size only (NOT read line-by-line), explicitly flagged as such:**
  the ~40 remaining `src/agent/tools/*` bodies (read.ts/grep.ts/web-fetch.ts are the largest
  and may hold their own oversized-function findings); `src/agent/mcp/*`; the ink components
  and web components beyond signatures; the auth/redact/tar/summary/log-retention server
  modules; and the large test files (`runtime.test.ts` ~2740 LOC, `loop.test.ts` ~2171 LOC)
  — sized, not audited. The individual `e2e/spikes/**/spike-*.ts` script bodies (13+14) were
  inspected only via their shared support layer.
- **Skipped entirely:** per-commit diff reading across the 632-commit range (used file-state
  + churn + targeted reads instead — no silent truncation: this is the deliberate sampling
  strategy the owner authorized for the full-history scope).

**Tickets filed (all `draft`, for coordinator triage → `refining`):**

| ID | Domain | One-line |
| --- | --- | --- |
| DH-0170 | TUI+Web+Contracts | TUI & Web reimplement the same client core (SSE transport, event reducer, ConnectionStatus, slash-parser) twice — **umbrella, needs decomposition** |
| DH-0171 | Core/providers | Consolidate duplicated provider helpers (mapStopReason etc.) + fix bedrock as-unknown casts |
| DH-0172 | Core/tools | Shared inputSchema-driven tool-input validation helper; kill per-tool typeof boilerplate |
| DH-0173 | Core/agent | Split the AgentRuntime God class; break up spawnAgent/runRoot |
| DH-0174 | Core/cli | Split cli.ts (2041 LOC) into modules; extract shared ANSI primitive |
| DH-0175 | Core+Contracts | Remove/sunset the deprecated TASK_FAILED text-marker self-report path |
| DH-0176 | cross-cutting | Audit coverage-gate-driven test patterns (branch-free helpers, synthetic constructors, giant test files) |
| DH-0177 | E2E | Consolidate mock-provider scaffolding + resolve spikes/ status & gate dependency |
| DH-0178 | CI/Release | De-duplicate Bun setup/install + centralize pinned bun-version across workflows |
| DH-0179 | Web | Revisit web dual-typecheck split to drop the loopback self-proxy + any-casts |
| DH-0180 | Server | Relocate FakeAgentLoop out of the production server entrypoint |
| DH-0181 | Server+TUI | Extract a shared tree-connector prefix helper (log dump ↔ TUI tree) |

**Flagged for escalation (CLAUDE.md §6), not routine — called out inside the tickets:**
- **DH-0170** — the shared parser / `Turn` type / event vocabulary / `ConnectionStatus`
  belong in `src/contracts/` (§6 item 2, architect sign-off) AND span two client domains
  that can't be cleanly sliced (§6 item 3). Filed as an umbrella to be decomposed, not
  implemented whole.
- **DH-0175** — removing the `"text-marker"` arm of `OutcomeReportedBy` is a
  `src/contracts/` change (§6 item 2).
- **DH-0176** — touches the locked 100%-coverage gate (§5 / §6 item 1). In-scope cleanups
  (fix the Bun synthetic-constructor quirk, behavior-shape the tests) must NOT weaken the
  gate; any weakening is owner/architect territory. Relates to DH-0149.

**Considered but deliberately NOT filed:**
- *Actions pinned to mutable tags, not SHAs* — already covered by open **DH-0031**
  (supply-chain hardening, owner-deferred in full); cross-referenced from DH-0178, not
  duplicated.
- *`CLI_TOOLS_SKILL_FALLBACK` unreachable branch* (`prompt/system-prompt.ts:19-33`) —
  intentional safety net asserted well-formed by a test; not worth a ticket.
- *`Header.tsx` `"empty"` variant TODO* — minor leftover from DH-0124, not standalone.
- *`resolveModel()`/`providerFor()` narrower unreachable case* (grace.md open thread) —
  forward-looking defensive code Grace deliberately kept; not dead-in-error.
- *The two markdown renderers* (`tui/markdown-ansi.ts` vs `web/client/markdown-dom.ts`) —
  legitimately two output targets (ANSI vs DOM) over the shared `src/markdown/` AST; the
  visitor bodies can't merge. Not filed.

**Do not:** close this ticket or add the `Refactoring-Round:` trailer commit — that is the
coordinator's call once this round's output is reviewed (per dispatch).

## Open Questions
