---
spile: ticket
id: DH-0093
type: feature
status: ready
owner: stefan
resolution:
blocked_by: []
created: 2026-07-16
relations:
  depends_on: []
  relates_to: [DH-0065]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0093: No slash-command system in TUI/Web (model switching, skill invocation, help/clear)

## Summary

Live testing surfaced a real gap: the model itself has no awareness of or access to any slash-command interface, and none exists -- typing /model in the TUI just gets sent as a literal chat message to the agent, which correctly reports it has no such capability. Real Claude Code has a slash-command system (/model, /clear, /help, per-skill commands, etc.) handled client-side/harness-side, never sent to the model as a chat turn. dh needs a reasonable minimal slash-command set, starting with /model (a model-selection UI/picker to switch the active model mid-session) and extending to exposing every loaded skill as its own /skillname command. This is a real interaction-model change (client-side command parsing/dispatch, possibly a new command message type distinct from a chat message) needing an architect design pass, not a mechanical addition.

## User Stories

### As an operator, I want a minimal, reasonable set of slash commands, handled locally, never sent to the model

- Given the operator types `/model` in the TUI or Web input box, when submitted, then a
  model-selection UI (picker over `dh.json`'s configured models) appears and switches the
  active model for the current session — no chat turn is sent to the agent.
- Given other common slash commands (`/help`, `/clear` at minimum — matching real Claude
  Code's minimal set), when typed, then they're handled the same way: locally, immediately,
  never forwarded as a chat message.

### As an operator, I want every loaded skill exposed as its own slash command

- Given a skill is loaded (per `skillPaths`), when the operator types `/<skillname>`, then
  it invokes that skill the same way real Claude Code's skill-as-slash-command convention
  works — implementer's/architect's call on exact invocation semantics (does it inject the
  skill's content as a message, run it as a distinct kind of turn, etc.).

## Design (architect pass — Fable, 2026-07-16)

Empirically grounded against real Claude Code on this machine (print mode, same practice as
DH-0069 onward): `/help` never reaches the model — the harness answers instantly with a
canned response; `/model` with no argument prints the current model plus the available list
(again no model turn), and `/model <name>` switches; an unknown `/xyz` yields
`Unknown command: /xyz` **client-side** — a slash-prefixed input is never forwarded as chat,
even when unrecognized. Skill slash commands in real Claude Code expand the skill's
instructions *into the turn* (a `<command-name>` block in the user message) — deterministic
expansion, not reliance on the model choosing to call a tool.

### 1. Command detection/dispatch

Interception is **client-side**, at the exact point a submitted input becomes a
`send_message`:

- **TUI:** `src/tui/state.ts` `handleRootKey`'s `enter` branch (the only place a
  `send_message` effect is built from `state.input`). Parsing is a new pure module
  `src/tui/commands.ts`: `parseSlashCommand(input): { name: string; args: string } | null`,
  matching `^/(\S+)(?:\s+(.*))?$`. The reducer stays pure — command handling produces state
  changes + effects exactly like every existing key path.
- **Web:** `src/web/client/app.ts` `callbacks.onSendMessage`, delegating to an equivalent
  pure parser in `src/web/client/` (each client owns its own 10-line parser, consistent with
  each owning its own state/render; the parse rule is not wire truth, so it does not belong
  in `src/contracts/`).

Rule (matches observed Claude Code behavior): any input matching `^/\S` is a command
attempt and is **never** sent as a chat turn. Unknown name → local error
`Unknown command: /xyz` (TUI: `statusMessage`; Web: error banner). Input starting with
`/ ` (slash-space) or a bare `/` is ordinary chat.

Detection needs no round-trip. Two commands need server *data or action* (below); `/help`
and `/clear` are fully local apart from the cached skill/model lists.

### 2. `/model` — picker + mid-session switch

**New wire commands** (`src/contracts/commands.ts`, additive to the `ClientCommand` union):

```ts
export interface ListModelsCommand { type: "list_models"; }
export interface ModelInfo {
  name: string;        // ModelConfig.name (the alias operators/config use)
  provider: string;    // ModelConfig.provider
  model: string;       // provider-side id, display only
  isDefault: boolean;  // === options.defaultModel
  isActive: boolean;   // the root agent's currently-active alias
}
export interface ListModelsResponse extends CommandAck { models: ModelInfo[]; }

export interface SwitchModelCommand {
  type: "switch_model";
  agentId: string;     // v1: must be the root agent; anything else is a 400 ack
  model: string;       // ModelConfig.name alias
}
```

`switch_model` answers with a plain `CommandAck` (`ok: false` + the existing
`ConfigModelError` message text for an unknown alias).

**Runtime mechanism (Core).** Today `runAgentLoop` receives
`model/providerModel/provider/pricing` fixed at call time, and `runRoot` resolves the model
once — but the loop's `while` body reads them per provider call, so the change is an
indirection, **not** a loop restart (a restart would destroy the in-memory `messages`
history, which is the whole conversation).

- `AgentLoopParams` gains `registerModelSwitch?: (fn: (binding: ModelBinding) => void) => void`
  where `ModelBinding = { model: string; providerModel: string; provider: ModelProvider;
  pricing?: AgentLoopParams["pricing"] }` — the exact mirror of the existing
  `registerSendMessage` sink pattern. The loop keeps a local mutable binding initialized
  from its params and uses it for every `provider.complete()` call and `computeCostUsd()`
  computation. A pushed switch takes effect on the **next** provider call; an in-flight call
  is never aborted.
- `AgentRuntime.switchModel(agentId, name)`: validates via the existing `resolveModel`
  (throws `ConfigModelError` → 400 ack), then either (a) root not started yet — records a
  pending initial model that the lazy `runRoot()` start uses instead of
  `options.defaultModel`, or (b) root live — pushes the new binding through the registered
  sink. Updates `rootModel` so `getAgentTree()` reflects reality immediately.
- **Observability** (both additive): new SSE event `model_switched { agentId, from, to }`
  in `src/contracts/events.ts` (clients gate on KNOWN_TYPES, so old clients ignore it —
  same additive precedent as DH-0089's `tool_call`/`tool_result`), and new log event
  `{ type: "model_switched", from, to }` in `src/contracts/log.ts`. The JSONL header's
  `model` stays the spawn-time value (headers are immutable); replaying a log means header
  model + folded switches. Cost accounting follows the new binding's pricing
  automatically.
- Scope: **root agent only** in v1 (`agentId` kept in the command shape for symmetry with
  `send_message`/`stop_agent` and forward-compat). Sub-agents are ad-hoc and short-lived;
  no operator story requires retargeting one mid-run.

**Server (Radia):** extend `isClientCommand` + `handleCommand`; `AgentLoopHandle` gains
`listModels(): ModelInfo[]` and `switchModel(agentId: string, model: string): void`;
Core's `AgentRuntimeLoopAdapter` (src/cli.ts) implements both by delegating to
`AgentRuntime`.

**UI shape:**

- **TUI:** new view kind `{ kind: "picker"; options: ModelInfo[]; selectedIndex: number }`,
  navigated exactly like the existing tree view (up/down move, enter selects, escape
  cancels back to root view). `/model` submitted → clear input, effect
  `{ type: "send_command", command: { type: "list_models" } }` → app.ts routes the
  response into a new `models_response` action → picker view. Enter → effect
  `switch_model` + return to root view + status message `model switched to <name>`. Rows
  show `name  (provider/model)` with active/default markers. `/model <name>` (argument
  form, as real Claude Code supports in print mode) skips the picker and switches
  directly.
- **Web:** same two forms. Picker is a modal/dropdown over the composer — click to select,
  full keyboard support (arrows + enter, escape closes). Exact widget styling is Susan's
  call; the list content/markers match the TUI's.

### 3. `/help`, `/clear`

- **`/help`** — fully local. Renders a local, never-sent transcript entry (TUI: a
  marker-style turn like the existing `"tool"`-role markers; Web: a system-styled
  transcript entry) listing the built-ins (`/model`, `/help`, `/clear`) plus every skill
  command from the cached skill list (name + description).
- **`/clear`** — **clears the local transcript view only**; no wire command. The agent's
  in-memory context is deliberately unaffected in v1, and `/help` must say so explicitly
  ("clears the local transcript view; the agent's context is unaffected") — honest
  labeling instead of a silent semantic lie. A true server-side context reset (real Claude
  Code's `/clear` semantics) needs loop surgery on `messages` and murky mid-task semantics;
  file it as a follow-up ticket if operators actually want it.

### 4. Skill-invocation slash commands

**New wire commands** (additive):

```ts
export interface ListSkillsCommand { type: "list_skills"; }
export interface SkillInfo { name: string; description: string; }
export interface ListSkillsResponse extends CommandAck { skills: SkillInfo[]; }

export interface InvokeSkillCommand {
  type: "invoke_skill";
  agentId: string;
  skill: string;   // frontmatter name, the same key the Skill tool uses
  args?: string;   // everything after the command name, verbatim
}
```

- **List:** `AgentLoopHandle.listSkills(): SkillInfo[]` returns a cache populated by one
  eager `discoverSkills()` scan (src/prompt/skills.ts, which already yields exactly
  `{name, description}`) at adapter construction — same eager fire-and-forget pattern as
  `McpManager.connectAll()`, and consistent with "skills are enumerated at startup" (the
  system prompt already freezes the list then). Includes the builtin `cli-tools`. Clients
  fetch it once at startup (alongside the existing `request_agent_tree` bootstrap) to
  resolve `/name` locally and to render `/help`.
- **Invocation semantics** — matches real Claude Code's deterministic in-turn expansion,
  option (b) over "rewrite to a polite ask that the model call the Skill tool" (option (a)
  costs an extra round-trip and relies on small models cooperating): the server loads the
  skill (`loadSkillFromPaths`, Core) and delivers the composed text through the **existing
  `sendMessage` path** — an ordinary user turn from the loop's point of view, zero loop
  changes. Unknown skill → `ok: false` 404 ack. Composition template lives in
  `src/prompt/` (a pure `composeSkillInvocation(skill, args)` — Iris owns the wording;
  Core imports it, same cross-import precedent as `CLI_TOOLS_SKILL_MD`):

  ```
  <command-name>/<name></command-name>
  <command-args><args></command-args>
  The operator invoked the /<name> slash command. Follow the skill's instructions below.

  <full SKILL.md content>
  ```

- **Client behavior:** local echo shows the raw `/name args` the operator typed (compact,
  like real Claude Code's transcript), not the expanded content — the expansion is visible
  in the JSONL log as the actual user message. Built-in names (`model`, `help`, `clear`)
  shadow same-named skills (documented; mirrors the builtin `cli-tools` shadowing
  precedent).

### 5. Domain assignment & sequencing

| Domain | Work |
| --- | --- |
| **Contracts** (architect-signed by this design) | `commands.ts`: `list_models`/`switch_model`/`list_skills`/`invoke_skill` + response/info shapes. `events.ts`: `model_switched` SSE event. `log.ts`: `model_switched` log event. All additive. |
| **Server** (Radia) | `isClientCommand` + `handleCommand` cases for the four commands; `AgentLoopHandle` interface additions (`listModels`, `switchModel`, `listSkills`, `invokeSkill`). |
| **Core** (Grace) | `registerModelSwitch` sink + per-turn binding in loop.ts; `AgentRuntime.switchModel` (pending-before-start + live push, `rootModel` update, SSE/log emission); skill-list cache + `invokeSkill` composition wiring; `AgentRuntimeLoopAdapter` implementations in src/cli.ts. |
| **TUI** (Mary) | `src/tui/commands.ts` parser; interception in `handleRootKey`; picker view kind + render; `/help` local entry; `/clear` local transcript reset; `model_switched` in KNOWN_TYPES + agent `model` update; startup `list_skills` fetch. |
| **Web** (Susan) | Parser + interception in `onSendMessage`; picker modal/dropdown; `/help`/`/clear` equivalents; `model_switched` handling; startup `list_skills` fetch. |
| **Prompt** (Iris) | `composeSkillInvocation` template in `src/prompt/`; README operator docs for the command set; optional one-line system-prompt note that `<command-name>` blocks are operator-invoked skill commands. |
| **E2E** (Hedy, follow-up) | PTY: `/model` picker → next mock-provider request carries the new provider-side model id (the mock records the `model` field — direct verification); `/help` renders locally with zero provider calls; `/skillname` → mock provider sees the expanded content. |

Sequencing: Contracts first (one small PR, this design is the sign-off), then Server + Core
in parallel (Server defines the handle methods, Core implements them), then TUI + Web in
parallel, E2E last.

## Status log

### 2026-07-16 — Backend round: Contracts + Server + Core implemented

Contracts, Server, and Core's slices of the design above are implemented and merged (`src/
contracts/commands.ts`/`events.ts`/`log.ts`, `src/prompt/skill-invocation.ts`, `src/agent/
loop.ts`/`runtime.ts`/`skills.ts`, `src/server/agent-loop.ts`/`commands.ts`/
`fake-agent-loop.ts`, `src/cli.ts`'s `AgentRuntimeLoopAdapter`). All four new commands
(`list_models`/`switch_model`/`list_skills`/`invoke_skill`) are live end to end against a
real `AgentRuntime`, wired through the real HTTP command handler, with 400/404 acks for the
error cases the design calls for (unknown model alias or non-root `agentId` on
`switch_model`; unknown skill name on `invoke_skill`). Model switching takes effect on the
loop's *next* turn without restarting it (messages history intact) — the root case is
covered end to end (root-not-started pending-switch path, and root-live push-through-sink
path); sub-agent switching remains explicitly out of v1 scope per the design (throws
`RootOnlyModelSwitchError`). `typecheck`/`lint`/`test:coverage` all green for this round's
new/changed code (the repo-wide 100% coverage aggregate has a handful of small pre-existing
gaps unrelated to this ticket — confirmed identical before/after on `main`). `e2e` has two
pre-existing failures in this sandbox (missing headless Chromium binary), also confirmed
identical before/after this round's changes — unrelated to DH-0093.

One minimal, unavoidable touch outside this round's assigned domains: `src/web/client/
state.ts` gained a explicit no-op `case "model_switched"` in its `applyEvent` exhaustiveness
switch (mirroring the existing `tool_call`/`tool_result` precedent) — the new additive SSE
event otherwise fails `tsc --noEmit -p src/web`'s compile-time exhaustiveness check. This is
NOT the real Web consumption of `model_switched` (no UI change, no picker) — just what's
needed for the whole repo to typecheck with the new event added to the union.

**Remaining for the TUI/Web round** (Mary/Susan, per the design's domain-assignment table):
client-side slash-command parsing/interception (`src/tui/commands.ts` and a Web-side
equivalent), the `/model` picker view/modal (TUI: a new `"picker"` view kind; Web: a
dropdown/modal over the composer), `/help`/`/clear` local-only handling, real
`model_switched` SSE handling (updating the displayed active model, not just the no-op
compile fix above), and a startup `list_skills` fetch (alongside the existing
`request_agent_tree` bootstrap) so `/name` and `/help` can resolve skill commands locally.

**Remaining for the E2E round** (Hedy, follow-up): PTY-driven `/model` picker → next
mock-provider request carries the new provider-side model id; `/help` renders locally with
zero provider calls; `/skillname [args]` → mock provider sees the expanded
`<command-name>`/`<command-args>` content. None of this backend round's own tests
substitute for real-binary E2E coverage of the client-side interception/rendering layer.

## Notes

> [!NOTE]
> Found 2026-07-16 by the owner during live testing — typed `/model` expecting a picker,
> instead the message went straight to the agent as chat text (correctly reported back as
> "no slash-command interface"). Related to DH-0065 (TUI polish) as a UX gap in the same
> area, not a duplicate.
