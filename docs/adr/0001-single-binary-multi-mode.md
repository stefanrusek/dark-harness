# ADR 0001: Single binary, multi-mode via flags

**Status:** Accepted

## Context

Dark Harness needs to run as a local interactive tool (TUI or web), as a headless server
for remote/dark-factory use, and as a client connecting to a remote server. Shipping
separate binaries per mode multiplies build/release/distribution work and risks the modes
drifting apart.

## Decision

One binary, `dh`. Two logical processes — **server** (runs agents, owns state/logs) and
**client** (console TUI or web UI) — composed by flags:

| Invocation | Behavior |
|---|---|
| `dh` | Local: server + console TUI, one process |
| `dh --web` | Local web: server + locally-served web UI |
| `dh --server` | Headless server only (port 4000 default, `--port` overrides) |
| `dh --connect <host>` | Console client to a remote server |
| `dh --connect <host> --web` | Web client, locally served, connected to a remote server |

`--instructions <file>` starts autonomous execution; `--job` exits on completion with the
exit-code contract (ADR 0006); `--config <path>` overrides `dh.json` location (default:
cwd).

## Consequences

- The server and client can be developed and tested independently but must share the wire
  contract (`src/contracts/`, ADR 0002) — no mode-specific protocol forks.
- `--port` is contextual: listen port for `--server`, target port for `--connect`.
- Distribution stays simple: one cross-compiled binary per platform, one release pipeline.
