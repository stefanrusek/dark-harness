// DH-0105: canonical four-state connection vocabulary shared with the Web client
// (docs/design/style-guide.md §1/§6). Previously this TUI-only set was
// "connecting" | "open" | "error" | "closed", with `error` firing transiently after every
// failed reconnect attempt (the client always keeps retrying — see sse-client.ts) and
// `closed` firing after every clean stream end (also always followed by a retry). Neither
// was actually a terminal/fatal state; both were mid-retry blips that the Web's
// `reconnecting` state already names correctly. `sse-client.ts` now distinguishes the
// initial connect from a post-drop retry (mirroring the Web's `lastEventId`-presence check)
// and only reports `disconnected` when the client actually stops trying (the loop exits on
// abort), matching the Web's `closed` (now `disconnected`), which only fires from an
// explicit `close()`.
//
// DH-0157: split out of types.ts (which was a mixed type+constant file, disallowed under the
// .type.ts/.constant.ts standing rules) — this file holds the constant plus the type derived
// from it via indexed access, which a .constant.ts file is allowed to do.

// Canonical, iterable list of `ConnectionStatus`'s literals. Exists so callers that need to
// enumerate/validate the vocabulary (e.g. a future `/status` picker, or defensive parsing of
// a value that crossed a process boundary) have one source of truth instead of re-listing the
// four strings by hand. `ConnectionStatus` is derived from this array (rather than declared
// independently) so the two can never drift out of sync.
export const CONNECTION_STATUSES = ["connecting", "live", "reconnecting", "disconnected"] as const;

export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];
