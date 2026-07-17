---
spile: project
project: Dark Harness
prefix: DH
counter: 114
---

# Dark Harness tracker

Spile-managed issue tracking for the `dh` project — see the top-level `PLAYBOOK.md` §4.7
(the backlog/issue-log artifact) for why this exists, and `docs/BACKLOG.md` for the prior
(now-superseded) prose form of the same issues. The spec itself is checked in at
[`SPILE-SPEC.md`](SPILE-SPEC.md) (v0.2.0, external upstream project — not ours to edit; if
we hit a real Spile bug/gap, file it as a ticket document to hand back upstream, per the
owner's existing process for that repo).

This is a **single-project repo**, so the project directory sits at `tracking/` directly —
no `tracking/<project>/` nesting layer.

`docs/adr/` stays separate: ADRs are locked *decisions*; tickets here are units of *work*.
`docs/handoffs/` keeps its existing role as the per-round work-order/status-log convention
for domain leads — new open work items get filed here as tickets going forward, but this
does not retroactively restructure the existing handoff history.

Ticket IDs are `DH-NNNN`, immutable once minted. See the generated view at
`views/dark-harness-view.md` for the current Needs Attention / Board / Recently Closed
summary — regenerate it whenever a ticket's status changes.
