# Web UI guide

`dh --web` (or `dh --connect <host> --web`) serves the web UI locally in your browser,
connected over the same HTTP+SSE protocol the console TUI uses (never served by a headless
`--server` process itself — see the [run modes table](../README.md#run-modes)).

## Layout

- **Agent tree** (left/top, depending on window size) — every agent in the session, root and
  sub-agents, indented by nesting depth. Click any entry to view that agent.
- **Agent panel** (main area) — the selected agent's structured conversation transcript: user
  turns, assistant turns, and tool calls/results shown as distinct blocks, in the order they
  happened. The root agent's panel also has a message box to send it new input; sub-agent
  panels are read-only, same as the TUI.
- **Status dot / badge** next to each tree entry and at the top of an agent's panel — reflects
  the agent's current `AgentStatus` (`running`, `waiting`, `done`, `failed`, `stopped`), color-
  coded so a stuck or failed sub-agent is visible without opening it.

## Token and cost display

Each agent entry and the session-total strip show `<input tokens> in · <output tokens> out ·
<cost>`. Cost is computed from `models[].inputPricePerMToken`/`outputPricePerMToken` in
`dh.json` ([config reference](../README.md#configuration--dhjson)) — if a model has no
pricing configured, its cost renders as a placeholder (e.g. `—`) rather than a misleading
`$0.00`, and it's excluded from the session total rather than treated as free.

## Downloading logs

Each agent's panel has a **Download log** button. It fetches that agent's JSONL log file
(the ADR 0005 per-agent log — see the [JSONL log format reference](jsonl-log-format.md)) as
a single file download, named after the agent id. Useful for feeding a single agent's history
into external tooling without pulling the whole session's log directory.

## Reconnection

The web UI (like the TUI) reconnects over SSE using `Last-Event-ID` if the connection drops —
you may see a brief "reconnecting" state in the status area, after which the tree and open
agent panel catch back up from where they left off rather than resetting.
