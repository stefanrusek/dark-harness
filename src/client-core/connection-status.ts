// DH-0105: canonical four-state connection vocabulary shared between the TUI and Web clients
// (docs/design/style-guide.md §1/§6). Previously the TUI-only set was
// "connecting" | "open" | "error" | "closed", with `error` firing transiently after every
// failed reconnect attempt (the client always keeps retrying — see sse-client.ts) and
// `closed` firing after every clean stream end (also always followed by a retry). Neither
// was actually a terminal/fatal state; both were mid-retry blips that the Web's
// `reconnecting` state already names correctly. The TUI's transport now distinguishes the
// initial connect from a post-drop retry (mirroring the Web's `lastEventId`-presence check)
// and only reports `disconnected` when the client actually stops trying (the loop exits on
// abort), matching the Web's `closed` (now `disconnected`), which only fires from an
// explicit `close()`.
//
// DH-0157: split out of a mixed type+constant file (disallowed under the .type.ts/.constant.ts
// standing rules) into its own constant module.
//
// DH-0183: consolidated into `src/client-core/` — this vocabulary had been declared twice
// (`src/tui/connection-status.constant.ts` and a local union in `src/web/client/state.ts`),
// already deliberately kept in sync by hand per the DH-0105/DH-0157 comments above. It is
// shared client-side vocabulary, not wire truth (never serialized in an SSE event — see
// DH-0170's architect decomposition notes), so it belongs here rather than in
// `src/contracts/`.

// Canonical, iterable list of `ConnectionStatus`'s literals. Exists so callers that need to
// enumerate/validate the vocabulary (e.g. a future `/status` picker, or defensive parsing of
// a value that crossed a process boundary) have one source of truth instead of re-listing the
// four strings by hand. `ConnectionStatus` is derived from this array (rather than declared
// independently) so the two can never drift out of sync.
export const CONNECTION_STATUSES = ["connecting", "live", "reconnecting", "disconnected"] as const;

export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];
