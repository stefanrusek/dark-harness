// DH-0136: pure text/ANSI helpers shared by the Ink view components — ported out of the old
// render.ts (now deleted) so this logic stays plain-function testable without a JSX harness.
// DH-0137: status/connection color+glyph+word is centralized in the shared, framework-
// independent `src/design-tokens.ts` module — nothing here re-declares those tables.
import type { AgentStatus } from "../../contracts/index.ts";
import { STATUS_TOKENS } from "../../design-tokens.ts";
import {
  formatCostUsd,
  formatTokenCountCompact,
  formatTokenCountFull,
  formatElapsed as sharedFormatElapsed,
} from "../../format.ts";
import { SPINNER_FRAME_MS, SPINNER_FRAMES } from "../../terminal.ts";
import type { TuiState } from "../types.ts";

const RESET = "\x1b[0m";
const SGR_PREFIX = "\x1b[";
const INVERSE = "\x1b[7m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

/** Synthetic cursor marker: an inverse-video space appended after the input text — see the
 * old render.ts's doc comment (ported verbatim). Only the root view's input line is editable. */
export const CURSOR_MARKER = `${INVERSE} ${RESET}`;

export function colorizeStatus(status: AgentStatus, text: string): string {
  return `${SGR_PREFIX}${STATUS_TOKENS[status].sgr}m${text}${RESET}`;
}

export function dim(text: string): string {
  return `${DIM}${text}${RESET}`;
}

export function bold(text: string): string {
  return `${BOLD}${text}${RESET}`;
}

export function spinnerFrame(now: number): string {
  const index = Math.floor(now / SPINNER_FRAME_MS) % SPINNER_FRAMES.length;
  return SPINNER_FRAMES[index] as string;
}

/** DH-0104: re-exported from the shared `src/format.ts` (matches Web's `formatElapsed`
 * byte-for-byte). */
export const formatElapsed = sharedFormatElapsed;

/** Format a token/cost figure — DH-0104's two-tier rule: `"compact"` (`12.3k`) for glanceable
 * chrome, `"full"` (`12,345`) for the detail agent view. */
export function formatTokenCost(
  inputTokens: number,
  outputTokens: number,
  costUsd: number | null,
  tokenStyle: "compact" | "full" = "compact",
): string {
  const totalTokens = inputTokens + outputTokens;
  const tokenCount =
    tokenStyle === "compact"
      ? formatTokenCountCompact(totalTokens)
      : formatTokenCountFull(totalTokens);
  return `${tokenCount} tok / ${formatCostUsd(costUsd)}`;
}

/** Session-wide token/cost totals summed across every currently-tracked agent (DH-0028). */
export function sessionTokenTotals(state: TuiState): {
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
} {
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd: number | null = null;
  for (const agent of state.agents.values()) {
    inputTokens += agent.inputTokens;
    outputTokens += agent.outputTokens;
    if (agent.costUsd !== null) costUsd = (costUsd ?? 0) + agent.costUsd;
  }
  return { inputTokens, outputTokens, costUsd };
}

export function rootAgent(state: TuiState) {
  return state.rootAgentId ? (state.agents.get(state.rootAgentId) ?? null) : null;
}

export function viewLabel(state: TuiState): string {
  switch (state.view.kind) {
    case "root":
      return "Root Agent";
    case "tree":
      return "Agent Tree";
    case "agent":
      return `Agent ${state.view.agentId}`;
    case "picker":
      return "Select Model";
  }
}
