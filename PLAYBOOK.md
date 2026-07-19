# Fleet Orchestration Playbook

A portable playbook for building software with a small fleet of AI agents: a coordinator
that holds the whole picture, domain leads that own slices of the system, and cheap
implementers that do the typing — coordinating asynchronously through durable documents
rather than a shared conversation.

This document is **project-neutral**. It describes the method, not any one codebase.
Each project keeps a thin project-specific layer (conventions, ownership map, invariants,
quality gates) in its own **constitution** file (e.g. `CLAUDE.md`) and points back here.
The naming is deliberate: this playbook is the reusable framework you drop into a new
project; the constitution is that project's binding law, written *against* this framework.
Don't conflate the two — amend this file when the *method* needs to evolve (as it did after
this playbook's first true from-scratch run surfaced real gaps — see §11), amend a project's
constitution when *that project's* conventions need to change.

---

## 1. When to use this

Use it when the work is too large for one agent's context, benefits from parallelism, and
spans separable domains (e.g. frontend / backend / native). It shines for multi-day builds
where continuity across context resets matters. It is overkill for a single well-scoped
change — reach for the fleet when the work-list itself is large or unknown.

The core bet: **judgment is scarce and expensive; typing is cheap and parallelizable.**
Everything below is arranged to spend intelligence where it changes outcomes and volume
where it doesn't.

---

## 2. Roles

- **Owner (human).** Holds intent, taste, and real-world authority the agents lack:
  credentials, elevation, approvals, "ship it." Makes product calls and irreversible
  business decisions. Everything ultimately routes to the owner for the things only a
  human can do or decide.

- **Coordinator (a.k.a. conductor/orchestrator).** Holds the whole picture. Decomposes
  work, writes the briefs, routes them, reconciles the shared repository, tracks status,
  and surfaces to the owner. **The coordinator does not implement** and does not make the
  hardest architectural calls alone — it escalates those (see §3). Most coordinator work
  is high-volume and low-judgment: monitor, route, commit, chase, keep documents current.

  **The role is defined as much by what it delegates as by what it does.** It's easy for a
  coordinator to quietly accrete hands-on work over a long session — hand-testing a feature,
  tracing a bug through the source, running the verification commands itself — because each
  instance feels small and each instance is, individually, faster to just do than to write up
  and route. Don't. **Delegate execution — testing, debugging/root-cause investigation,
  gate-running/verification — to a dispatched agent, even a one-off, throwaway one; retain
  judgment: what to prioritize, what a finding means, whether to merge, when to escalate.**
  "The coordinator is responsible for merging" means owning the *decision* and the
  consequences, not personally typing the verification commands — dispatch the check, act on
  its report. If you notice yourself running a test, reading a stack trace, or diagnosing a
  regression rather than assigning someone (or something) to do it, that's the tell.

- **Domain leads.** Each owns a slice of the system (a set of directories/packages).
  A lead takes a brief, breaks it into concrete tasks, and delegates the typing to
  implementers. Leads own integration within their slice and report status up.

- **Implementers.** Do the actual writing against a tight brief: exact files, the wire
  contract, the gates to run, and what "done" means. Cheapest capable tier. Their output
  is judged by objective gates, not by re-reading.

- **Architect-on-call (the "smarty-pants").** A frontier-tier agent invoked *only* for
  genuine judgment: setting or changing a locked decision, slicing a hard decomposition,
  reviewing a risky diff, resolving a cross-cutting design smell. Not always running —
  called when an escalation trigger fires (§3).

These roles are **functions, not necessarily separate processes.** A single agent can wear
several; the point is to assign each function the cheapest tier that does it well.

### Naming and identity (do this from the start)

Give every long-running instance a **name and pronouns**, recorded in the constitution's
roster. In a fleet that coordinates through a shared repository, "the backend agent" and
"the native agent" turn ambiguous fast — *which* instance, this session or the one that
pushed overnight? Names fix that; roles and directories attach to a name, and the history
reads as people, not process IDs.

- **Agents name themselves as they come online** (the coordinator first, then each lead as
  it's stood up). Self-chosen names stick better than assigned ones.
- **Default to she/her** — a deliberate, standing acknowledgment that women are
  underrepresented in computing and no less capable, carried in every agent's identity. A
  themed roster (e.g. pioneering women in computing) reinforces it and aids recall.
- **Record persistence:** mark each name **persistent** (a continuous instance) or
  **ephemeral** (a pod spun up on demand and dissolved, with no continuity of context
  between spin-ups). Readers of the roster need to know which they're addressing.

- **When to promote a role to a persistent name (with a roster file) versus dispatch it
  anonymously:** a persistent name carries a durable, auditable identity across time — its
  roster file accretes a real history even though each invocation is a fresh process with no
  memory of the last. An anonymous one-off dispatch has no equivalent trail; its existence is
  visible only in whatever conversation or handoff spawned it. **Promote to a persistent
  named role when a category of work recurs and its history needs to be inspectable later**
  (a domain lead who'll take handoff after handoff over the project's life). **Keep it
  anonymous for a genuine one-shot task** (a single investigation, a single verification
  pass) — but even then, the coordinator is responsible for making sure anything the dispatch
  *finds* lands in a durable document. The dispatch itself doesn't need permanence; its
  findings always do (see §4's new backlog artifact, and §11).

---

## 3. Model tiers and escalation — the crux

The expensive mistake is paying frontier rates for clerical work. The expensive *risk* is
letting a cheap tier make a decision that ripples across the system. Split by job:

| Function | Tier | Why |
| --- | --- | --- |
| Monitoring / heartbeat / git hygiene | Cheapest (or a script/cron) | Pure clerical; frontier rates here are pure waste |
| Coordination (route, brief, commit, chase) | Mid (e.g. Sonnet) | High volume, modest judgment |
| Implementation | Cheap–mid, by task difficulty | Judged by gates, not re-read |
| Hard decisions / decomposition / risky review | Frontier (on-call) | Low volume, high stakes, ripples widely |

**Decision density is front-loaded.** Greenfield bootstrap (empty repo → stack choice,
founding architecture, first decomposition) is almost all judgment; a frontier brain
hands-on there earns its cost. Once the architecture stabilizes and work becomes
execution, transition to a **mid-tier coordinator + frontier architect-on-call.** That
transition is the main cost lever.

**Escalation triggers (write these down; do not leave to vibes).** The coordinator calls
the architect-on-call when — and only when — it hits one of:
1. A decision that sets, changes, or bends a locked decision or a system invariant.
2. A decomposition it cannot cleanly slice (unclear ownership, tangled dependencies).
3. A cross-cutting concern touching multiple domains at once.
4. A diff in security-, correctness-, money-, or data-integrity-sensitive code.
5. Two agents' outputs that conflict and need arbitration.
6. Anything the coordinator notices it is guessing at.

Under-escalation yields mediocre decisions; over-escalation burns the savings. The trigger
list is the single most important thing to tune per project. Everything else routes to the
owner (for authority/taste) or stays with the coordinator (for routine calls).

---

## 4. The substrate — artifacts, not conversation

What makes this work asynchronously across context resets is that agents coordinate through
**durable documents**, not a shared chat. Six artifact types:

1. **The constitution** (e.g. `CLAUDE.md`). Binding, always-in-context rules every agent
   obeys: stack decisions, ownership map, invariants, quality gates, workflow rules. Short
   enough to always load. This is the project's law.

2. **Locked decisions (ADRs).** One page per significant decision: the problem, the
   decision, the rationale, the consequences. Once accepted, they are not re-litigated —
   they are *referenced*. New information amends via a new dated section or a superseding
   ADR, never a silent rewrite. ADRs are how a fleet avoids relitigating the same call
   every time a fresh context appears.

3. **Handoff documents.** The API between agents — a self-contained work order addressed
   to a specific role: context, exact scope (files/dirs), the wire contracts, constraints,
   gates, and a crisp "definition of done." See §5 for conventions.

4. **Single source of wire truth.** All cross-component types/schemas/protocol messages
   live in one shared module (e.g. a `contracts` package), as the authoritative definition
   other components import. Never redeclare a wire type locally. This is what keeps
   independently-built components integrating cleanly.

5. **Objective quality gates.** Machine-checkable "done": test coverage thresholds,
   typecheck, lint/format, an e2e pass. Implementers are judged by these, which is what
   lets you trust cheap-tier output without re-reading every line.

6. **Ownership map.** A directory/package → owner assignment so two agents physically
   cannot collide. Part of the constitution.

7. **Backlog / issue log.** Every issue, gap, or observation — raised by the owner, found
   during testing, surfaced in passing conversation, or noted as a calibration example while
   scoping other work — is written to disk **at the moment it's raised**, not deferred to
   memory. Size the artifact to the issue: a one-line entry in a tracked list for something
   small; a real spec (user stories, acceptance criteria) for something substantial — a
   bullet point under-describes a feature's worth of work and the detail gets lost by the
   time anyone acts on it. This is not a write-only log: **the coordinator periodically
   re-reads it** and either acts on each entry directly or brings it back to the owner for a
   decision. Anything not committed to a durable document this way survives only as long as
   it stays in someone's attention — which, across context resets and parallel agents, is not
   long. See §11 for the failure mode this closes.

### The ticket-triage workflow

"Re-reads it and acts on it" needs its own concrete shape once the backlog has real volume
(e.g. after a comprehensive gap-analysis dump per the anti-pattern fix in §9 — one such run
can produce dozens of tickets at once). Sort every open, not-yet-dispatched item into exactly
three buckets, in this order:

1. **Ready to queue now.** Well-scoped, no real design ambiguity, doesn't touch a locked
   decision or security-sensitive surface, doesn't need the owner's judgment first — a domain
   lead could pick it up from the ticket alone and go. Transition it to the tracker's
   "ready to implement" state and dispatch (or queue to dispatch) directly.
2. **Needs the owner's input before it's dispatched.** Anything that would trip an
   escalation trigger (§3) if it were code instead of a ticket: touches a locked decision or
   invariant, is security/correctness-sensitive, requires a product/priority call, or has real
   cross-cutting design ambiguity a domain lead shouldn't resolve alone. Mark it as blocked
   (not silently left in a neutral status) so it surfaces distinctly from ordinary backlog —
   the block reason should say what decision is needed, not just "waiting."
3. **Do after the first two groups.** Real and worth doing, but lower urgency, needs more
   definition before it's even ready to ask the owner about, or is a larger speculative
   feature — leave it in the backlog's normal (unblocked, not-yet-ready) state.

While triaging, also look for **overlap between findings** raised by different sub-agents or
sweeps — cross-link related tickets (a `relates_to`-style reference) rather than letting near-
duplicates sit unconnected; comprehensive capture (§9) means some redundancy across
independent sweeps is expected, and it's the coordinator's job to notice and connect it, not
silently ignore or merge away the record of it.

### Gating speculative features on real demand, not guesswork

A subclass of bucket 3 deserves a specific default, not just "leave it in the backlog": a
sweep- or comparison-driven finding proposing real capability nobody has actually asked for or
hit a need for yet (as opposed to a confirmed bug, a security gap, or something the owner
explicitly wants). The default for these is to **defer the whole thing, not a cheap partial
version of it** — don't scope down to "just the easy part" as a middle ground; if it's not
worth doing, a smaller version of not-doing-it is still not doing it. This applies to
speculative hardening (a threat with no observed incident) exactly as much as speculative
features (a capability with no observed request) — the same judgment call, just two flavors
of "nobody's actually hit this yet."

For a project with real users/community, one useful default-deferral shape: rather than
silently dropping the idea, have the product **detect the situation and point at a public
place to register interest** (e.g. a GitHub issue describing the gap, linked back to the
internal ticket for whoever eventually picks it up) instead of either building it speculatively
or losing the idea entirely. This turns "nobody's asked for this" from a guess into something
that can actually be measured — real demand shows up as issue engagement, not as a sub-agent's
assessment of what sounds useful. Keep the internal ticket itself in the backlog regardless
(deferred, not closed) so the two stay linked and the eventual build has a real design behind
it already. Note that filing a real public issue is a genuine visible/external action per the
"executing actions with care" guidance the underlying agent framework already carries — confirm
with the owner before actually posting one, the same way you would before any other action
visible outside the local repo.

---

## 5. Handoff document conventions

The handoff is the load-bearing artifact. Conventions that prevent the common failures:

- **A handoff is a document for a *named other agent* to execute — never a to-do for its
  author.** The coordinator writes handoffs and routes them; it does not turn around and
  execute them itself. (If the same agent will do the work, it's not a handoff — it's just
  work.) This distinction is easy to violate and expensive when violated.

- **Self-contained.** Assume the reader has none of the author's conversation. State the
  context, the exact files/dirs in scope, the wire contracts to build against, the
  constraints/invariants that apply, the gates to run, and what "done" looks like.

- **Scoped to an owner.** A handoff touches only its addressee's directories. Cross-domain
  needs are stated as *requests* to the other owner ("I need this field added to the shared
  contract — request it, don't fork it"), not as edits across the boundary.

- **Status supersedes.** A later report from the agent doing the work supersedes the
  coordinator's earlier assumptions. Handoffs accrete dated sections; readers act on the
  latest. The coordinator reads the agent's latest report before asserting status —
  getting stale is a real and recurring failure.

- **Escalate, don't guess.** When executing a handoff surfaces a genuine decision or a
  blocker requiring authority (credentials, elevation, a product call), the agent writes up
  the finding and its options and routes it up — it does not quietly pick a direction on a
  locked-decision-class question, and it does not route around a safety boundary.

---

## 6. Coordination protocol (shared repository)

Multiple agents writing to one repository need discipline. Two viable models:

- **Shared working tree** (all agents in one checkout): strict directory ownership; **commit
  before you yield** (never leave a turn with a dirty tree another agent might trip on);
  **monitoring is fetch-only** (never rebase/stash/reset over another agent's uncommitted
  work — it rewrites their tree underneath them); reconcile with rebase only from a clean
  tree; on a shared branch **revert, never force-push** (history is append-only). Push your
  own commits as plain fast-forwards; if a rebase would be needed while someone else is
  mid-edit, wait.
- **Per-agent worktrees** (each agent its own checkout of the same repo): agents physically
  cannot disturb each other's working files; they integrate only through commits/branches.
  More setup, fewer collisions. Prefer this when agents edit in parallel and step on each
  other under the shared-tree model.

Either way: **directory ownership is the primary collision-avoidance mechanism**, and the
coordinator is the reconciler of record.

**Per-agent worktrees, mechanized:** `.claude/skills/forked-subagent/` gives the "per-agent
worktrees" model above a filesystem-enforced form, for when directory-ownership convention
alone isn't enough — it launches a sub-agent as a real OS subprocess (the `claude` CLI, not
the in-process `Agent` tool) with `cwd` hard-scoped to a dedicated `git worktree`, so a
confused implementer physically cannot write outside its assigned worktree regardless of what
its prompt says. Built after a real incident (2026-07-16): an in-process `Agent`-dispatched
sub-agent ran a bare `git commit` in the shared checkout and swept another agent's staged
files into an unrelated commit, briefly breaking `main` (see `tracking/DH-0114-*.md`). Use it
for implementation dispatches with real file-write risk; the in-process `Agent` tool remains
the lower-overhead default for read-only research and quick lookups where isolation doesn't
matter.

---

## 7. How work flows

1. **Owner intent** arrives (a feature, a fix, a direction).
2. **Decision, if needed.** If it sets/changes architecture or an invariant, the
   coordinator (escalating to the architect-on-call per §3) resolves it and records an ADR.
   Otherwise it proceeds.
3. **Decompose into handoffs**, one per owning domain, self-contained (§5).
4. **Domain leads execute**: break the brief into tasks, delegate typing to implementers,
   integrate within their slice against the shared contracts and gates.
5. **Reconcile**: the coordinator integrates results, watches for cross-domain mismatches,
   keeps the shared tree healthy.
6. **Surface to the owner**: outcomes, decisions needed, anything only a human can do.
   Loop.

Escalation directions are fixed: **up to the owner** for authority/taste/irreversible
calls; **to the architect-on-call** for hard judgment; **stay with the coordinator** for
routine routing and reconciliation.

### 7.1 Wave execution (owner-preferred pattern, confirmed 2026-07-19)

For a backlog of several ready-to-implement tickets, the coordinator runs them as a
**wave**: dispatch every independently-implementable ticket in parallel (isolated
worktrees per §6), then, as each reports back, merge/verify/push it immediately rather
than waiting for the whole wave to finish. Tickets that are tightly coupled (same shared
module, same high-churn file) get combined into one dispatch instead of two agents racing
each other on the same files — see §6's directory-ownership principle, applied at dispatch
time, not just merge time. A ticket whose worktree turns out to need a large, high-stakes
merge (the file is central/risky, e.g. the core agent loop) gets its own dedicated merge
agent rather than a coordinator hand-resolve, per §6's per-agent-worktree guidance.

**Standing owner authorization:** once a wave is dispatched, the coordinator keeps
executing it — dispatch, merge, verify gates, push, dispatch the next dependent ticket —
**without stopping to ask for go-ahead at each step.** ("You have my permission to just do
all these without stopping — if you do need me, hold only the one ticket and keep going.")
If a specific ticket genuinely needs owner input (a real product decision, not an
implementation detail an agent can reasonably decide), the coordinator holds *that ticket
only* and keeps the rest of the wave moving — it does not stall the whole wave on one
open question. This extends to the periodic refactoring-round mechanism (§9's
process-doc equivalent, `docs/design/refactoring-round-prompt.md`): the coordinator closes
a round's `Refactoring-Round: DH-XXXX` trailer commit on its own once it has reviewed
what the architect filed, rather than asking first.

The coordinator still reports back when a wave/round genuinely completes, or when
something surprising or risky is found (a real bug, a design conflict, a stale-worktree
mismatch) — this authorization removes routine "here's what landed, what next?"
check-ins, not visibility into outcomes.

**Ticket minting stays in the primary checkout.** `new_ticket.py` (spile-ops) allocates the
next `DH-NNNN` ID from `tracking/README.md`'s `counter:` field, a tracked file with one
physical copy per worktree. If a wave's isolated worktrees each mint tickets independently,
they can mint the same ID from the same stale counter value, discovered only when the
branches merge (this happened for real — `DH-0213` minted twice during refactoring round
DH-0216, see `tracking/DH-0217-*.md`). The tool itself now refuses to mint from a linked
worktree (`git rev-parse --git-common-dir` vs `--git-dir`); the underlying convention is
still: any ticket-filing need discovered mid-dispatch is relayed back to the coordinator's
own primary checkout to mint, never run in place inside the dispatched worktree.

---

## 8. Bootstrap — authoring the founding handoff

A fleet needs a founding artifact: the giant initial handoff that turns an empty repo into
a working plan (product spec, locked decisions, invariants, repository layout, work
packages, and the constraints implementers must honor).

**This founding brief can be authored in a frontier-model *chat*, outside the coding
harness, and then handed to the coding fleet to execute.** You do not need the code harness
to *write* the plan — only to *run* it. Draft the spec with a frontier model conversation,
land it in the repo as the driving document, seed the constitution (`CLAUDE.md`) and the
first ADRs from it, then let the coordinator take over. This front-loads the densest
judgment into the cheapest place to do it (a single focused chat) before any fleet cost is
incurred.

---

## 9. Anti-patterns (learned the hard way)

- **Executing your own handoff.** If you wrote it as a handoff, route it; don't do it. (§5)
- **Disturbing a peer's working tree.** Autostash/rebase/reset over someone's uncommitted
  work rewrites their files mid-edit. Monitoring is fetch-only. (§6)
- **Referencing reverted/abandoned work.** Work you did and undid is invisible to the other
  agents; mentioning it only confuses. Communicate current state, not your private history.
- **Stale coordinator.** Asserting status from old assumptions when a fresh report exists.
  Read the latest report first; status supersedes. (§5)
- **Re-litigating locked decisions.** If it's an ADR, reference it. Amend deliberately;
  don't silently reopen.
- **Forking the wire contract.** Redeclaring a shared type locally to move faster creates
  integration drift. Request the change in the shared module. (§4)
- **Paying frontier rates for clerical work.** The monitor/heartbeat is the cheapest tier or
  a script — never a frontier model running `fetch` on a timer. (§3)
- **Silent truncation.** If an agent caps its coverage (top-N, sampling, no-retry), it says
  so. Unstated limits read as "covered everything" when they didn't.
- **Using a finding only as a calibration example.** Mentioning an issue to prime another
  agent's analysis (e.g. "here are two examples of the kind of gap I mean") is not the same
  as tracking it. The example is itself a candidate finding and needs its own entry in the
  backlog (§4.7) — it does not get to ride along implicitly on the analysis it seeded. This
  bit twice in the same project before being named as a pattern.
- **Asking a research/analysis dispatch for a prioritized list instead of a comprehensive
  one.** Finding everything and deciding what matters are two different jobs. Bake them into
  one instruction and the agent's own judgment about what's "worth mentioning" silently
  gates what ever reaches paper — low-priority-but-real findings can vanish before the
  coordinator ever sees them. Always ask for the full inventory first, no self-filtering;
  make prioritization an explicit, visible second pass, not an implicit filter on the first.

---

## 10. Extraction checklist (adopting this on a new project)

Portable (lift as-is): this document; the role model; the tier/escalation framing; the
handoff/ADR/coordination conventions; the "founding handoff in a chat" bootstrap; the
naming/identity practice (agents self-name, default she/her, record persistence).

Project-specific (write fresh each time):
- The **constitution** (`CLAUDE.md`): stack, ownership map, invariants, gates, workflow.
- The **founding handoff / spec**: product decisions and work packages.
- The **ownership map**: which directories belong to which domain lead.
- The **quality gates**: the exact coverage/lint/typecheck/e2e thresholds.
- The **escalation triggers**: tuned to where *this* project's judgment actually lives.

Start a new project by drafting the founding handoff in a frontier chat (§8), distilling
its constraints into a fresh `CLAUDE.md` that points back to this file, then standing up the
coordinator.

---

## 11. Case study: what this playbook's first from-scratch run surfaced

This playbook was originally distilled *after the fact* from a project that developed the
method ad hoc. The build this file now lives in was its first true maiden voyage — adopted
from day one rather than reconstructed afterward — and, as a founding document finally
getting exercised for real, it had gaps. Three showed up clearly enough to amend the method
itself rather than just patch the one project:

1. **Coordinator scope crept** over a long session: hands-on testing, live debugging, and
   gate-running all quietly became things the coordinator just did, rather than dispatched.
   Amended in §2 (Roles).
2. **A recurring theme — an owner's live testing turned up a real UX gap that was mentioned
   in conversation but never written down**, and separately, **two concrete examples given
   to a research agent purely to calibrate its thinking were never independently tracked** —
   both instances of the same failure: something raised, never committed to disk, quietly
   lost. Amended in §4 (new backlog artifact) and §9 (two new anti-patterns).
3. **A gap-analysis dispatch was asked for a "prioritized list"** and delivered exactly
   that — a curated list, not a comprehensive one — meaning anything the research agent
   judged low-priority may never have surfaced at all. Amended in §9.

None of these are project-specific to Dark Harness; all three are gaps in the *method*,
which is why they landed here rather than in that project's own constitution.

---

*Distilled from a real multi-day, multi-agent build. Refine it as you learn — this file is
itself a living artifact.*
