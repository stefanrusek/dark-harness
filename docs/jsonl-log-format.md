# JSONL log format reference (user-facing)

Every `dh` session writes one JSONL file per agent (root and every sub-agent, any nesting
depth) into a session log directory under `.dh-logs/<sessionId>/`. This is the operator-
facing reference for building tooling against those files. The schema itself is defined in
`src/contracts/log.ts` and locked by
[ADR 0005](adr/0005-jsonl-per-agent-logging.md) — that ADR is the authoritative source if
this page and the code ever disagree.

## Shape

Each file is newline-delimited JSON. The **first line is always a header**; every
subsequent line is an **event**. A tool that only reads first lines across every file in a
session directory can reconstruct the whole session's agent tree and timeline without
parsing any event bodies.

### Header (first line, `type: "header"`)

| Field | Type | Meaning |
| --- | --- | --- |
| `version` | `1` | Header schema version. |
| `sessionId` | string | Shared across every agent's file in one session. |
| `agentId` | string | Unique to this file/agent. |
| `parentAgentId` | string \| null | `null` for the root agent; the spawning agent's id otherwise. |
| `spawnedAt` | ISO timestamp | When this agent started. |
| `model` | string | The `dh.json` model name (not the provider-side id) this agent ran with. |
| `instructionsSummary` | string | A summary/hash of the instructions or spawn prompt this agent received. |
| `client` | `"tui" \| "web" \| "server" \| "none"` | How the log-writing *process* was invoked (ADR 0001 mode composition) — a one-shot fact, not a live tracker of every client that later connects to a long-running `--server`. |
| `build` | `{ version, gitSha, dirty, releaseTag }` | Build identity stamped into the binary at compile time. `gitSha`/`releaseTag` are `null` for an unstamped (from-source) build. |
| `description` | string (optional) | Human-readable label from the `Agent` tool's `description` param, if the spawner supplied one. Absent for the root agent and for sub-agents spawned without it. |

`client` and `build` are required on newly-written headers as of the 2026-07-15 ADR 0005
amendment; log files written before that amendment won't have them — tooling should treat
both as optional when reading historical logs.

### Events (every subsequent line)

All events share `version: 1` and a `timestamp` (ISO string), plus a `type` discriminant:

| `type` | Notable fields | Meaning |
| --- | --- | --- |
| `message` | `role` (`user`\|`assistant`\|`system`), `content` | A conversation turn. |
| `tool_call` | `toolName`, `toolUseId`, `input` | A tool invocation, before its result is known. |
| `tool_result` | `toolUseId`, `output`, `isError` | The result of a `tool_call`, matched by `toolUseId`. |
| `token_usage` | `inputTokens`, `outputTokens`, `cacheReadTokens?`, `cacheWriteTokens?`, `costUsd?` | Per-turn token accounting. `costUsd` is present only when the model has pricing configured in `dh.json` (`inputPricePerMToken`/`outputPricePerMToken`); its absence means "unpriced," not "free." |
| `status_change` | `status`: `"running" \| "waiting" \| "done" \| "failed" \| "stopped"` | Agent lifecycle transition. `"stopped"` (deliberately ended via the `TaskStop` tool) is a distinct signal from `"failed"` — don't conflate them in analysis tooling. |
| `completed` | `success: true` | Terminal success marker. |
| `failed` | `reason` | Terminal failure marker with a reason string. |

## Practical notes for tooling

- **Truncated final line.** A session can end mid-write (crash, kill). Readers should
  tolerate a truncated/invalid final line in any file rather than failing the whole parse.
- **Secrets.** Token redaction happens at the log-writing layer per the security posture
  ([ADR 0004](adr/0004-security-posture.md)) — a bearer token configured via
  `security.token` is never written to these logs.
- **Reconstructing the tree.** Build the parent/child structure purely from each header's
  `agentId`/`parentAgentId` — don't infer nesting from file names or directory layout, which
  aren't part of the contract.
