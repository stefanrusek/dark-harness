---
spile: ticket
id: DH-0076
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: []
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0076: No TaskCreate/TaskList/TaskGet/TaskUpdate-equivalent structured todo/plan tracking for the main agent

## Summary

Real Claude Code has a TaskCreate/TaskGet/TaskList/TaskUpdate tool family (a structured todo-list the main agent maintains for its own multi-step plan, visible to the operator), distinct from the TaskOutput/TaskStop/Monitor/SendMessage tools dh already has for supervising spawned sub-agent jobs. dh has no equivalent for an agent tracking its own in-progress plan/checklist. This is a judgment call on whether it's worth building for dh's coding-agent use case (long multi-step coding tasks) versus being purely cosmetic; filed as draft for scoping.

## User Stories

### As an operator watching a long multi-step coding task, I want to see the agent's own plan/checklist, not just its raw tool calls

- Given an agent working a task with several discrete steps, when it maintains a structured
  todo list via TaskCreate/TaskUpdate-equivalent calls, then the TUI/Web UI can render that
  checklist (done/in-progress/pending) as a first-class view, distinct from the raw
  tool-call transcript.
- Given a sub-agent spawned via the `Agent` tool (already tracked via TaskOutput/Monitor/
  SendMessage/TaskStop), when it also maintains its own internal todo list, then the two
  concepts (job supervision vs. self-tracked plan) are clearly distinguishable in the UI and
  don't get conflated.

## Design (architect pass, 2026-07-16 — Fable)

### Scope call (resolves the ticket's own Open Question)

**Build the tool family. Defer the UI.** The cheap alternative — a prompt-level "narrate
your plan in text" convention — does not deliver most of the value, and here is the real
argument, not a punt: a text-narrated plan has no authoritative, re-readable state. Over a
long multi-step run (dh's dark-factory use case — long unattended coding tasks — is
exactly the worst case) the model restates its plan inconsistently, drops items, and can
only recover its own plan by re-reading scrollback it may have summarized away. A
structured store gives it a cheap anchor: `TodoList` re-reads current ground truth at any
point in the conversation for a few dozen tokens, and each status flip is an explicit,
logged state transition rather than prose drift. This is precisely why real Claude Code
ships this as a tool family (TodoWrite historically, TaskCreate/TaskGet/TaskList/
TaskUpdate today) rather than as a system-prompt convention. The self-organization value
requires **zero contracts change**; the operator-visibility value (the TUI/Web checklist
in this ticket's first user story) is real but separable — deferred to a follow-up ticket
with the SSE event shape pre-approved below, so pursuing it later costs no second
architect round-trip.

### Naming: the `Todo` family (`TodoCreate` / `TodoGet` / `TodoList` / `TodoUpdate`)

Mirroring real Claude Code's `Task*` names verbatim is untenable in dh: `TaskOutput`,
`TaskStop`, `Monitor`, and `SendMessage` already operate on `task_id`s minted by
`TaskRegistry` (`src/agent/tasks.ts`) for *real running jobs* (background Bash, spawned
sub-agents). A `TaskCreate`/`TaskList` sitting next to `TaskStop` would read as one family
while being two unrelated subsystems, and two different id namespaces both spelled
`task_id` would be a live confusion hazard for the model calling the tools.

`Todo` over `Plan`, for three reasons:

1. **It is real Claude Code's own name for exactly this concept** — the self-authored
   checklist was `TodoWrite`/"todos" before Claude Code renamed the family; `Todo*` keeps
   fidelity to the upstream concept while dodging dh's collision.
2. `Plan` connotes a single prose document (and, upstream, plan-*mode* — a different
   feature); "todo" correctly connotes a list of discrete, individually checkable items.
3. The derived names read naturally (`TodoList` *is* the todo list).

Concretely: tool names `TodoCreate`/`TodoGet`/`TodoList`/`TodoUpdate` (four tools, 1:1
with the real family, per the owner's "as closely as practical"); id parameter `todo_id`
(snake_case, matching dh's `task_id` precedent); generated ids `todo-1`, `todo-2`, …
(visibly disjoint from `TaskRegistry`'s `bash-N`/`agent-N` even in prose). Files:
`src/agent/todos.ts` (store), `src/agent/tools/todo-create.ts` etc.

### Tool schemas

Four thin tools over one per-agent store. All follow the existing `Tool` shape
(`src/agent/tools/types.ts`): `additionalProperties: false`, validation errors returned as
`isError: true` tool results (matching `task-output.ts`/`task-stop.ts` style), never
thrown.

**TodoCreate** — returns `Created todo-N: <subject>`:

```json
{
  "type": "object",
  "properties": {
    "subject": { "type": "string", "description": "Brief imperative title, e.g. 'Fix auth token refresh'" },
    "description": { "type": "string", "description": "Optional fuller context / acceptance criteria" },
    "active_form": { "type": "string", "description": "Optional present-continuous label shown while in progress, e.g. 'Fixing auth token refresh'" },
    "blocked_by": { "type": "array", "items": { "type": "string" }, "description": "Optional todo ids that should complete before this one" }
  },
  "required": ["subject"],
  "additionalProperties": false
}
```

**TodoGet** — full record for one todo (id, status, subject, description, active_form,
blocked_by, blocks [derived inverse], created_at, updated_at):

```json
{
  "type": "object",
  "properties": { "todo_id": { "type": "string" } },
  "required": ["todo_id"],
  "additionalProperties": false
}
```

**TodoList** — no parameters; compact one-line-per-todo listing
(`todo-2 [in_progress] Fix auth token refresh (blocked_by: todo-1)`) plus a count summary,
with an explicit empty-state message:

```json
{ "type": "object", "properties": {}, "additionalProperties": false }
```

**TodoUpdate** — single mutator, including delete (matching real Claude Code, where
TaskUpdate is the one mutation surface); requires at least one mutation field:

```json
{
  "type": "object",
  "properties": {
    "todo_id": { "type": "string" },
    "status": { "type": "string", "enum": ["pending", "in_progress", "completed", "deleted"] },
    "subject": { "type": "string" },
    "description": { "type": "string" },
    "active_form": { "type": "string" },
    "add_blocked_by": { "type": "array", "items": { "type": "string" } },
    "remove_blocked_by": { "type": "array", "items": { "type": "string" } },
    "add_blocks": { "type": "array", "items": { "type": "string" } },
    "remove_blocks": { "type": "array", "items": { "type": "string" } }
  },
  "required": ["todo_id"],
  "additionalProperties": false
}
```

Semantics:

- **Statuses:** `pending` / `in_progress` / `completed`; `deleted` removes the record and
  all edges referencing it. No enforced transition graph — any status may be set from any
  other (correcting a mistaken `completed` back to `in_progress` must work).
- **Dependencies are advisory, not enforced.** `blocked_by`/`blocks` are inverse views of
  one edge set. Completing a todo that still has incomplete blockers succeeds but the tool
  result appends a warning naming them. No cycle detection — edges are self-authored
  planning metadata with no execution semantics, so a cycle is the model's own note to
  itself, not a scheduler deadlock. Referencing an unknown todo id in any edge param is an
  `isError` result.
- Tool descriptions advise keeping exactly one todo `in_progress` at a time (the upstream
  convention) but nothing enforces it.

### Storage / state model

- New `TodoStore` class in `src/agent/todos.ts` — deliberately **not** `TaskRegistry`, no
  shared code, no shared id space. `TaskRegistry` supervises real concurrent processes
  (abort controllers, output buffers, message sinks); `TodoStore` is a dumb ordered map of
  records with zero execution semantics. Conflating them would be a category error.
- **One store per agent, per conversation.** Root and every sub-agent each own an
  independent store (matching real Claude Code); nothing is inherited or shared. Lives on
  the agent-loop state alongside message history — i.e. it survives across turns for the
  agent's whole conversation, and dies with the agent. No filesystem persistence.
- **Bounded** (DH-0012 spirit): hard cap of 200 live todos per store; `TodoCreate` beyond
  the cap is an `isError` result telling the model to complete/delete first. `deleted`
  records are actually removed, not tombstoned.
- **No logging-schema change:** tool calls/results already land automatically in the
  per-agent JSONL log (ADR 0004), so the full todo history is reconstructible from
  existing events.
- **No contracts change in this ticket.** UI visibility is deferred, with the follow-up's
  contract pre-approved here to make it cheap: a new SSE event in `src/contracts/events.ts`
  carrying the **full snapshot** (not a delta) of one agent's todos on every mutation —
  `{ type: "todo_state", agentId, todos: TodoSnapshot[] }` extending `SseEventBase`.
  Snapshot semantics mean clients need no reducer and `Last-Event-ID` resume is trivial
  (latest event wins). That follow-up touches Contracts + Core (emit) + Server (fan-out) +
  TUI + Web (render), and this paragraph is the architect sign-off for the event shape.

### Domain assignment

- **Core (Grace), this ticket:** `TodoStore`, the four tools, registration in the tool
  set, unit tests to the 100% gate. No other domain in scope.
- **Prompt (Iris), companion one-liner (coordinator to slice as its own small task):** a
  short system-prompt nudge to use the Todo family for multi-step work — upstream Claude
  Code pairs the tools with prompt guidance, and the tools earn their keep only if the
  model reaches for them unprompted.
- **Follow-up ticket (recommended, not minted here):** "Surface per-agent todo checklist
  in TUI/Web via `todo_state` SSE event" — Contracts/Core/Server/TUI/Web, event shape
  pre-approved above.

## Assumptions

- Grounding caveat, stated plainly: the architect pass attempted to exercise real Claude
  Code's TaskCreate/TaskGet/TaskList/TaskUpdate live (per this session's empirical
  practice, DH-0069–0081) and the family is **not enabled in this environment** — verified
  by direct tool-list inspection, two ToolSearch probes, and an independent subagent's
  own three-way check. The design is therefore grounded in the documented behavior of the
  family (statuses pending/in_progress/completed, subject/description/activeForm fields,
  blocks/blockedBy dependency edges, TaskUpdate as sole mutator including delete) plus
  dh's own code, not a live transcript. Field spellings above are dh-adapted (snake_case)
  regardless, so residual upstream-schema uncertainty does not gate implementation.
- The value driver is model self-organization on long multi-step runs; operator
  visibility is secondary and separable (hence the deferral).

## Risks

- **Vocabulary collision is resolved by design** (`Todo*`/`todo_id`/`todo-N` vs
  `Task*`/`task_id`/`bash-N`/`agent-N`) but reviewers should hold the line: any future
  tool touching this store must stay in the `Todo` namespace.
- Advisory (unenforced) dependencies could surprise a model expecting enforcement; the
  completion-with-incomplete-blockers warning in the tool result mitigates this.
- If the Prompt-domain nudge is skipped, the tools may sit unused and the feature will
  look low-value on inspection; the nudge is small but load-bearing.

## Open Questions

- None blocking implementation. (Whether TodoList wants a status filter, and when to
  schedule the UI-visibility follow-up, are coordinator calls for later.)

## Notes

> [!NOTE]
> Found 2026-07-16 during the systematic tool-schema/behavior comparison against real
> Claude Code prompted by the owner following DH-0069. Filed for completeness per the
> "file everything real, don't pre-filter for importance" instruction, but flagged here as
> the lowest-confidence/most speculative finding in the batch -- may turn out to be a
> judgment call the coordinator declines to pursue.

> [!NOTE]
> Owner decision (2026-07-16): queue, not speculative — the owner considers this a genuinely
> useful tool for agents doing real implementation work to track their own progress. Route to
> the architect to design it matching real Claude Code's TaskCreate/TaskGet/TaskList/
> TaskUpdate functionality as closely as practical for dh's shape (naming must avoid clashing
> with dh's existing Task*/task_id vocabulary for sub-agent job supervision, per this
> ticket's own Open Question).

> [!NOTE]
> Architect design pass complete (2026-07-16, Fable): `Todo` tool family
> (TodoCreate/TodoGet/TodoList/TodoUpdate), per-agent in-memory `TodoStore` in Core, no
> contracts change now, UI visibility deferred to a follow-up with the `todo_state` SSE
> event shape pre-approved in the Design section. Ready for Core (Grace), with a companion
> Prompt one-liner for Ada to slice.
