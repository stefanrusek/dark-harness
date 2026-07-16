---
spile: ticket
id: DH-0093
type: feature
status: refining
owner: stefan
resolution:
blocked_by: ["architect design pass in progress"]
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

## Functional Requirements

- Client-side (TUI `src/tui/`, Web `src/web/client/`) command parsing: a message starting
  with `/` is intercepted before being sent as a chat turn.
- Real interaction-model question: does switching models mid-session require a new
  server/protocol command (`src/contracts/commands.ts`), or can it be handled purely
  client-side against already-known config? Given `dh.json`'s model list is currently only
  loaded server-side, this likely needs a way for the client to know what models exist and
  a command to actually switch the active one for the running agent loop — probably a real
  `src/contracts/` change.
- Given this is a meaningfully new interaction model, not a mechanical addition, this needs
  an architect design pass per Constitution §6.2/§6.3 before implementation.

## Notes

> [!NOTE]
> Found 2026-07-16 by the owner during live testing — typed `/model` expecting a picker,
> instead the message went straight to the agent as chat text (correctly reported back as
> "no slash-command interface"). Related to DH-0065 (TUI polish) as a UX gap in the same
> area, not a duplicate.
