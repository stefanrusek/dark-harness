---
spile: ticket
id: DH-0240
type: bug
status: draft
owner: stefan
resolution:
blocked_by: []
created: 2026-07-19
relations:
  depends_on: []
  relates_to: [DH-0057]
  supersedes: []
implementation:
  - repo: dark-harness
---

# DH-0240: MCP OAuth (DH-0057) dead code: unused resourceMetadataUrl field and unreachable alreadyAuthenticated flag on the client_credentials return

## Summary

Two dead-code items in the DH-0057 MCP OAuth implementation (Core, src/agent/mcp/), found in refactoring round 2 (DH-0239).

Both items are self-contained cleanups in the Core-owned MCP OAuth code (`src/agent/mcp/`),
introduced by DH-0057 (`6aa5604`) and confirmed dead by grep + control-flow trace during
refactoring round 2. Neither changes observable behavior; both are naming/hygiene noise that
misleads the next reader of this code.

### Finding 1 — unused `resourceMetadataUrl` field (dead)

`src/agent/mcp/token-store.ts:36` declares `resourceMetadataUrl?: string` on `StoredMcpAuth`,
but the identifier appears **nowhere else in the repo** — never written, never read. Drop the
field (or, if it is a deliberate placeholder for a planned resource-metadata-discovery feature,
add a comment saying so; there is no such note today).

### Finding 2 — unreachable `alreadyAuthenticated: true` on the client_credentials return

`src/agent/mcp/manager.ts:335-339` returns `{ grant: "client_credentials",
alreadyAuthenticated: true, ...optionalExpiry(tokens) }`. The tool handler
(`src/agent/tools/mcp-auth.ts:78-83`) branches on `result.grant === "client_credentials"`
**first** and returns before ever reaching the `if (result.alreadyAuthenticated)` check at
`mcp-auth.ts:84`, so the flag on this particular return object is never observed. It is also
semantically off — the client_credentials grant runs the token exchange inline, it is not an
"already authenticated / existing tokens still valid" case. Remove `alreadyAuthenticated: true`
from the `client_credentials` return in `manager.ts`.

Note: the *other* `alreadyAuthenticated: true`, on the `authorization_code` /`AUTHORIZED`
return at `manager.ts:353-357`, **is** live (read at `mcp-auth.ts:84`) — leave it. Only the
client_credentials one is dead.

### Optional, only if this code is being touched anyway (not required)

Naming drift: the injected façade exposes `status` / `begin` / `complete`
(`src/agent/runtime.ts:471-476`, `McpAuthFacade` in `types.type.ts`) while the underlying
`McpManager` methods are `authStatus` / `beginAuth` / `completeAuth`. Two vocabularies for the
same three operations force a mental remap when tracing tool→manager. Harmless; align only if
the façade is being edited for the above fixes.

## User Stories

### As a maintainer reading the MCP OAuth code, I want no dead fields or unreachable flags, so the code's shape reflects its actual behavior

- Given `StoredMcpAuth`, when I search the repo for `resourceMetadataUrl`, then the only match
  is either gone or accompanied by a comment explaining its intended future use.
- Given the `client_credentials` begin flow, when it returns, then the returned object carries
  no `alreadyAuthenticated` flag (which the handler never reads on that path).
- Given the `authorization_code` `AUTHORIZED` (tokens-still-valid) begin flow, when it returns,
  then `alreadyAuthenticated: true` is still present and still drives the "already
  authenticated" handler message (regression guard — do not remove this one).

## Functional Requirements

- Remove the unused `resourceMetadataUrl?: string` field from `StoredMcpAuth`
  (`src/agent/mcp/token-store.ts`), or document its intended use.
- Remove `alreadyAuthenticated: true` from the `client_credentials` return in
  `McpManager` (`src/agent/mcp/manager.ts:335-339`); leave the `authorization_code` one intact.
- Existing MCP OAuth tests continue to pass; 100% coverage maintained (CLAUDE.md §5).

## Assumptions

- `resourceMetadataUrl` is genuinely abandoned, not load-bearing via a dynamic/serialized path
  the grep missed (searched `src/`; it is a persisted-token shape, so also confirm no on-disk
  token file consumer depends on the key before deleting).

## Risks

- Low. Both are removals of never-observed state. The one live `alreadyAuthenticated` is called
  out explicitly above to avoid an over-eager delete.

## Open Questions

## Notes

- Filed by refactoring round 2 (DH-0239). Markdown colored-span rendering and the
  DH-0230/0231/0232 TUI fixes were re-reviewed in the same round and came back clean.
