# ADR 0009: Workflow orchestration scripts are compatible with the "ad-hoc sub-agents only" invariant

**Status:** Accepted (Fable, architect-on-call, 2026-07-19)

**Scopes / clarifies:** CLAUDE.md §4 invariant 8 ("Sub-agents are ad-hoc only — no
named/predefined agent definition files"). This ADR does **not** reverse or relax that
invariant; it draws the boundary of what invariant 8 governs so the DH-0213 Workflow tool
can be built without relitigating it later.

## Context

DH-0213 researched a `dh`-native `Workflow` tool modeled on Claude Code's own: a deterministic
orchestration script (plain JS/TS with `agent()`/`parallel()`/`pipeline()` primitives) that
coordinates sub-agent calls with real control flow instead of leaving multi-step orchestration
to model judgment turn by turn. Such a script is a persistent, checked-in, invokable-by-name
artifact.

CLAUDE.md §4 invariant 8 states sub-agents are "ad-hoc only — no named/predefined agent
definition files; `Agent` takes a model name + prompt; arbitrary nesting depth." A checked-in
Workflow script is, on its face, "named" and "predefined," which reads as being in tension
with that wording. DH-0213 flagged this (its "Biggest architectural tension" section) and
escalated the interpretation per CLAUDE.md §6 item 1 (anything that would set, change, or bend
an invariant is an architect call). This ADR is that ruling.

## Decision

**Invariant 8 governs sub-agent *personas/identities*, not orchestration *control flow*.**

What invariant 8 rules out is a checked-in file that *is a sub-agent* — a predefined identity
with a baked-in system prompt / role / `subagent_type` that a spawn selects *instead of*
supplying a model + prompt ad hoc (the "senior-reviewer-agent.md with a fixed persona" pattern
from Claude Code's named-subagent system). The reason that pattern is barred is design taste
recorded in the invariant: every spawn in `dh` is a fresh, fully-specified `{model, prompt}`
with no hidden identity, so behavior is legible from the call site, not from a registry of
personas.

A Workflow **script** does not introduce a persona. It is deterministic control flow — the
same category as `scripts/build.ts`: checked-in trusted automation. Every sub-agent it spawns
is still fully ad hoc, going through the *exact same* `spawnAgent({model, prompt, ...})`
primitive the `Agent` tool uses, with no predefined identity, no `subagent_type`, no baked
system prompt. The script names a *procedure*, never an *agent*. Under this reading invariant 8
does not block it.

### Guardrails (binding on the DH-0213 implementation and any future Workflow work)

For a Workflow script to stay on the permitted side of invariant 8, all of the following hold:

1. **Ad-hoc spawns only.** A Workflow's `agent()` primitive resolves to
   `ctx.spawnAgent({model, prompt, ...})` — a model name (defaulting to
   `options.defaultModel`, exactly like the `Agent` tool) plus a prompt supplied at the call
   site. It must not introduce a named-persona / `subagent_type` / registry-of-agents concept.
2. **No baked identity.** A Workflow script may carry orchestration metadata about *itself*
   (its own name/description — the future `meta` block), but must not define reusable
   sub-agent personas (fixed system prompts / roles) that spawns select by name. Prompts may
   be composed by the script; they may not be *registered identities*.
3. **Same fan-out budget.** Every spawn a Workflow makes flows through `spawnAgent`'s existing
   `maxAgentDepth`/`maxConcurrentAgents` checks (DH-0013). Workflows get no privileged path
   around the budget backstop.

If a future feature ever wants genuinely named, reusable sub-agent *personas*, that is a
different decision that would actually amend invariant 8 and needs its own ADR — this one does
not open that door.

## Consequences

- DH-0213's Workflow tool can be built in Core (`src/agent/`) as a peer of the `Agent` tool
  without amending CLAUDE.md §4 invariant 8. No change to the invariant's wording is required;
  this ADR is the authoritative scope note it now carries.
- The "no named agent definition files" prohibition remains fully in force for what it was
  written for: predefined sub-agent personas. A reviewer seeing a checked-in
  `workflows/*.ts` script should read it as automation (like `scripts/`), not as a smuggled
  agent-definition registry, and should reject any Workflow script that defines selectable
  sub-agent personas per guardrail 2.
- Execution-model, on-disk-location, and MVP-scope decisions for the Workflow tool are settled
  separately in DH-0213's rulings and the spun-off implementation ticket; this ADR only
  resolves the invariant-8 tension.
