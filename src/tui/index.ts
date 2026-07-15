// Public entry point for the TUI domain. Core's src/cli.ts calls startTui(baseUrl, token?)
// to launch the console client (per docs/handoffs/tui.md, Round 2: token is the configured
// `security.token`, threaded into an `Authorization: Bearer <token>` header on every
// request — omit/undefined for an unauthenticated server).

export { startTui } from "./app.ts";
