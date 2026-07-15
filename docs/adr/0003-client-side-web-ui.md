# ADR 0003: Web UI is always served client-side

**Status:** Accepted

## Context

`dh --server` is meant to be a minimal headless surface (agent API + event protocol only),
often run in a container with no exposed web-facing port beyond what's strictly needed for
the agent protocol. If the server also served the web UI's static assets, every headless
deployment would carry UI bundle weight and an extra attack surface, and `--server`'s scope
would blur.

## Decision

The web UI is **always served by the client side, never by the headless server.**
`dh --server` exposes only the agent API/event protocol (ADR 0002). Anyone wanting web
access to a headless server runs `dh --connect <host> --web` on their own machine — that
process serves the UI locally and connects to the remote server over the same HTTP+SSE
protocol any console client would use.

## Consequences

- `--server` stays minimal: no static-asset serving, no UI bundle in the headless deploy
  path.
- The web UI is just another protocol client, architecturally — same SSE/POST contract as
  the console TUI, so there is exactly one client↔server contract to maintain, not two.
- Local convenience mode (`dh --web`) is server + client-role-serving-UI in one process,
  composed the same way `dh --connect --web` is, just with the server loopback-local.
