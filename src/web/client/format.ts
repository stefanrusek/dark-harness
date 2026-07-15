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

/** Short id for display: keeps a stable prefix so identical ids remain visually distinct. */
export function shortAgentId(agentId: string): string {
  return agentId.length <= 10 ? agentId : `${agentId.slice(0, 8)}…`;
}

export function suggestedLogFilename(agentId?: string): string {
  return agentId ? `${agentId}.jsonl` : "dh-session-logs.tar.gz";
}
