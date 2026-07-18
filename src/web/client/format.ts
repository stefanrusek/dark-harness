// Pure formatting/presentation helpers — no DOM. Kept separate from render.ts so every
// formatting rule is unit-testable without a DOM shim.

import type { AgentStatus } from "../../contracts/index.ts";
// DH-0104 (docs/design/style-guide.md §4): token/cost/elapsed formatting is now defined
// once in the shared `src/format.ts` module and re-exported/wrapped here, rather than
// hand-kept-in-sync copies — see that module's header comment for the full two-tier rule.
import {
  formatTokenCountCompact,
  formatCostUsd as sharedFormatCostUsd,
  formatElapsed as sharedFormatElapsed,
} from "../../format.ts";
import type { ConnectionStatus } from "./state.ts";

export interface StatusStyle {
  label: string;
  /** CSS custom-property name (e.g. "--status-running") the render layer maps to a color. */
  token: string;
}

const STATUS_STYLES: Record<AgentStatus, StatusStyle> = Object.freeze({
  running: { label: "Running", token: "running" },
  waiting: { label: "Waiting", token: "waiting" },
  done: { label: "Done", token: "done" },
  failed: { label: "Failed", token: "failed" },
  // Round 13 (docs/handoffs/core.md): new terminal AgentStatus distinct from "failed" — a
  // deliberately-stopped task/agent, not a fault. Web's own token/label call, revisit if
  // Susan wants different styling.
  stopped: { label: "Stopped", token: "stopped" },
});

export function agentStatusStyle(status: AgentStatus): StatusStyle {
  return STATUS_STYLES[status];
}

// DH-0105: canonical connection-state labels (docs/design/style-guide.md §1/§6), Title
// Case per the Web casing rule (DH-0100, §4). Shared word/vocabulary with the TUI —
// `EXPECTED_CONNECTION_LABEL_WORDS` in the test file asserts this table stays in sync.
const CONNECTION_LABELS: Record<ConnectionStatus, string> = Object.freeze({
  connecting: "Connecting…",
  live: "Live",
  reconnecting: "Reconnecting…",
  disconnected: "Disconnected",
});

export function connectionStatusLabel(status: ConnectionStatus): string {
  return CONNECTION_LABELS[status];
}

/** Compact human count: 950 -> "950", 12_345 -> "12.3k", 1_234_567 -> "1.2M". Web only ever
 * uses this compact glanceable-chrome form (badges/strips) today — re-exported from the
 * shared `src/format.ts` (DH-0104) so it stays byte-for-byte identical to the TUI's tree-row
 * rendering rather than a hand-kept-in-sync copy. */
export const formatTokenCount = Object.freeze(formatTokenCountCompact);

/** Canonical cost rendering (DH-0104, docs/design/style-guide.md §4): 2-dp, `<$0.01` for a
 * tiny nonzero amount, `—` for unknown/unpriced — re-exported from the shared
 * `src/format.ts` so Web and the TUI's interactive views render identically. `null`/
 * `undefined` mean "unknown" (see `AgentNode.hasCost`/`SessionTotals.costUsd` in
 * `state.ts`). */
export const formatCostUsd = Object.freeze(sharedFormatCostUsd);

export function formatExitCode(exitCode: number): string {
  if (exitCode === 0) return "success (exit 0)";
  if (exitCode === 1) return "task failure (exit 1)";
  return `harness error (exit ${exitCode})`;
}

/**
 * Formats an elapsed duration (ms, clamped to >= 0) as a compact "time in current status"
 * / "last event at" label — e.g. "just now", "42s", "3m 12s", "1h 05m". Deliberately coarse
 * (drops sub-second precision) since its job is letting an operator eyeball "still a normal
 * turn" vs. "this has been running a suspiciously long time," not precise timing.
 */
export const formatElapsed = Object.freeze(sharedFormatElapsed);

/** Short id for display: keeps a stable prefix so identical ids remain visually distinct. */
export function shortAgentId(agentId: string): string {
  return agentId.length <= 10 ? agentId : `${agentId.slice(0, 8)}…`;
}

/**
 * DH-0066: phrases the agent header's status-elapsed label without the broken-English
 * "WAITING for just now" — `formatElapsed`'s "just now" already reads as a complete phrase
 * on its own, so the "for" prefix only makes sense once there's an actual duration to
 * attach it to.
 */
export function formatStatusElapsed(ms: number): string {
  const elapsed = formatElapsed(ms);
  return elapsed === "just now" ? elapsed : `for ${elapsed}`;
}

/** Compact token-count label with a unit suffix ("80 tok") so a bare integer in the sidebar
 * doesn't read as a mystery number next to a time label (DH-0066). */
export function formatTokenLabel(n: number): string {
  return `${formatTokenCount(n)} tok`;
}

export function suggestedLogFilename(agentId?: string): string {
  return agentId ? `${agentId}.jsonl` : "dh-session-logs.tar.gz";
}
