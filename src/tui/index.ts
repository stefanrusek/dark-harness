// Public entry point for the TUI domain. Core's src/cli.ts calls
// startTui(baseUrl, token?, opts?) to launch the console client (per docs/handoffs/tui.md,
// Round 2: token is the configured `security.token`, threaded into an
// `Authorization: Bearer <token>` header on every request — omit/undefined for an
// unauthenticated server). DH-0059: `opts.ownsServer` tells the TUI whether Ctrl+C should
// send `stop_agent` before quitting (local mode) or just detach (`--connect` mode) — only
// cli.ts knows which, since it's the one that did or didn't construct the `DhServer`.

export { startTui } from "./app.ts";
export type { StartTuiOptions } from "./app.ts";
