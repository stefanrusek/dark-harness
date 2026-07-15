// Pure formatting/presentation helpers — no DOM. Kept separate from render.ts so every
// formatting rule is unit-testable without a DOM shim.

import type { AgentStatus } from "../../contracts/index.ts";
import type { ConnectionStatus } from "./state.ts";

export interface StatusStyle {
  label: string;
  /** CSS custom-property name (e.g. "--status-running") the render layer maps to a color. */
  token: string;
}

const STATUS_STYLES: Record<AgentStatus, StatusStyle> = {
  running: { label: "Running", token: "running" },
  waiting: { label: "Waiting", token: "waiting" },
  done: { label: "Done", token: "done" },
  failed: { label: "Failed", token: "failed" },
  // Round 13 (docs/handoffs/core.md): new terminal AgentStatus distinct from "failed" — a
  // deliberately-stopped task/agent, not a fault. Web's own token/label call, revisit if
  // Susan wants different styling.
  stopped: { label: "Stopped", token: "stopped" },
};

export function agentStatusStyle(status: AgentStatus): StatusStyle {
  return STATUS_STYLES[status];
}

const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  connecting: "Connecting…",
  open: "Live",
  reconnecting: "Reconnecting…",
  closed: "Disconnected",
};

export function connectionStatusLabel(status: ConnectionStatus): string {
  return CONNECTION_LABELS[status];
}

/** Compact human count: 950 -> "950", 12_345 -> "12.3k", 1_234_567 -> "1.2M". */
export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs < 1000) return String(Math.round(n));
  if (abs < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function formatCostUsd(costUsd: number): string {
  if (!Number.isFinite(costUsd) || costUsd === 0) return "$0.00";
  if (costUsd < 0.01) return "<$0.01";
  return `$${costUsd.toFixed(2)}`;
}

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
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 1) return "just now";
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (totalMinutes < 60) return `${totalMinutes}m ${String(seconds).padStart(2, "0")}s`;

  const totalHours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${totalHours}h ${String(minutes).padStart(2, "0")}m`;
}

/** Short id for display: keeps a stable prefix so identical ids remain visually distinct. */
export function shortAgentId(agentId: string): string {
  return agentId.length <= 10 ? agentId : `${agentId.slice(0, 8)}…`;
}

export function suggestedLogFilename(agentId?: string): string {
  return agentId ? `${agentId}.jsonl` : "dh-session-logs.tar.gz";
}
