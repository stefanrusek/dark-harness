// DH-0136: the always-visible title bar ("Dark Harness — <view> — <connection>…"), ported from
// the old render.ts's `headerRows`. Distinct from `<Header>` (DH-0122's still-empty reserved
// slot) — this is existing, already-shipped chrome, not new content.
import { Text } from "ink";
import { CONNECTION_TOKENS } from "../../design-tokens.ts";
import type { TuiState } from "../types.ts";
import {
  bold,
  dim,
  formatTokenCost,
  sessionTokenTotals,
  spinnerFrame,
  viewLabel,
} from "./tokens.ts";

const SGR_PREFIX = "\x1b[";
const RESET = "\x1b[0m";

export function titleBarText(state: TuiState, _cols: number): string {
  const sessionSuffix = state.sessionEnded
    ? `  session ended (exit ${state.sessionEnded.exitCode})`
    : "";
  const reconnectSuffix = state.reconnectNotice ? `  ⚠ ${state.reconnectNotice}` : "";
  const totals = sessionTokenTotals(state);
  const totalsSuffix = dim(
    `  —  ${formatTokenCost(totals.inputTokens, totals.outputTokens, totals.costUsd)}`,
  );
  const appName = bold("Dark Harness");
  const connectionToken = CONNECTION_TOKENS[state.connection];
  const connectionGlyph = connectionToken.pending ? `${spinnerFrame(state.now)} ` : "";
  const connection = `${SGR_PREFIX}${connectionToken.sgr}m${connectionGlyph}${connectionToken.tuiLabel}${RESET}`;
  const rootAgentInfo = state.rootAgentId ? (state.agents.get(state.rootAgentId) ?? null) : null;
  const spinnerSuffix =
    rootAgentInfo?.status === "running" ? `  ${spinnerFrame(state.now)} working…` : "";
  return `${appName} — ${viewLabel(state)} — ${connection}${spinnerSuffix}${totalsSuffix}${sessionSuffix}${reconnectSuffix}`;
}

export interface TitleBarProps {
  state: TuiState;
  cols: number;
}

export function TitleBar({ state, cols }: TitleBarProps) {
  return (
    <>
      <Text>{titleBarText(state, cols)}</Text>
      <Text>{dim("─".repeat(Math.max(1, cols)))}</Text>
    </>
  );
}
