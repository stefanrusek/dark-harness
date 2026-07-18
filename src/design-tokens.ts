// DH-0137 (docs/design/style-guide.md §1/§1.2/§2.3): shared, framework-independent design
// tokens for the status/connection color+glyph+word tables — same "root-level src/ shared
// module, imported by both src/web/client/ and src/tui/" precedent as src/format.ts (DH-0104).
// Extracted so React (Web) and Ink (TUI) component trees can't independently re-derive these
// tables and silently drift from style-guide.md or from each other, the way STATUS_COLOR
// (src/tui/render.ts) and STATUS_STYLES (src/web/client/format.ts) previously did.
//
// Casing is a presentation-layer decision left to each consumer (style-guide.md §4): every
// `word`/label here is the canonical lowercase form; callers apply Title Case on Web
// themselves.
import type { AgentStatus } from "./contracts/log.type.ts";

/** The four connection-pill states (style-guide.md §1.2, DH-0105) — TUI's `ConnectionStatus`
 * (src/tui/types.ts) and Web's `ConnectionStatus` (src/web/client/state.ts) are each defined
 * independently as this same literal union; this module intentionally doesn't import either
 * (neither owns the other) and instead re-states the shared vocabulary once here. */
export type ConnectionState = "connecting" | "live" | "reconnecting" | "disconnected";

export interface StatusToken {
  /** Canonical lowercase status word (style-guide.md §1). */
  word: string;
  /** Status dot glyph — `●` for every status per style-guide.md §3. */
  glyph: string;
  /** Web CSS custom-property name (style-guide.md §2.1), e.g. `--status-running`. */
  webVar: string;
  /** Web hex value (style-guide.md §1/§2.3), e.g. `#4f8cff`. */
  webHex: string;
  /** TUI/CLI SGR foreground code (style-guide.md §1/§2.3), e.g. `34`. */
  sgr: string;
}

export interface ConnectionToken {
  /** Web pill label, Title Case (style-guide.md §1.2/§4). */
  webLabel: string;
  /** TUI/CLI pill label, lowercase (style-guide.md §1.2/§4). */
  tuiLabel: string;
  /** SGR foreground code shared by both surfaces' rendering of this state. */
  sgr: string;
  /** True for the two pending/in-flight states (`connecting`, `reconnecting`) — style-guide.md
   * §1.1 — so a consumer doesn't need to re-derive "is this pending" from the label. */
  pending: boolean;
}

/** style-guide.md §1 — five `AgentStatus` values, one canonical glyph+word+color per status,
 * both surface representations from the one shared row so a color assignment can never
 * update on one surface without the other. */
export const STATUS_TOKENS: Record<AgentStatus, StatusToken> = {
  running: {
    word: "running",
    glyph: "●",
    webVar: "--status-running",
    webHex: "#4f8cff",
    sgr: "34",
  },
  waiting: {
    word: "waiting",
    glyph: "●",
    webVar: "--status-waiting",
    webHex: "#f5a524",
    sgr: "33",
  },
  done: { word: "done", glyph: "●", webVar: "--status-done", webHex: "#35c469", sgr: "32" },
  failed: { word: "failed", glyph: "●", webVar: "--status-failed", webHex: "#f2545b", sgr: "31" },
  stopped: {
    word: "stopped",
    glyph: "●",
    webVar: "--status-stopped",
    webHex: "#9a7bd1",
    sgr: "35",
  },
};

/** style-guide.md §1.2 (DH-0105) — four connection states, shared TUI/Web vocabulary. */
export const CONNECTION_TOKENS: Record<ConnectionState, ConnectionToken> = {
  connecting: { webLabel: "Connecting…", tuiLabel: "connecting…", sgr: "33", pending: true },
  live: { webLabel: "Live", tuiLabel: "live", sgr: "32", pending: false },
  reconnecting: { webLabel: "Reconnecting…", tuiLabel: "reconnecting…", sgr: "33", pending: true },
  disconnected: { webLabel: "Disconnected", tuiLabel: "disconnected", sgr: "31", pending: false },
};
