// DH-0136: agent tree/sidebar view, ported from render.ts's `renderTree`.
import { Box, Text } from "ink";
import { flattenTree } from "../tree.ts";
import type { TuiState } from "../types.type.ts";
import { wrapText } from "../width.ts";
import { colorizeStatus, dim, formatElapsed, formatTokenCost } from "./tokens.ts";

/** Pure row-builder, ported verbatim from render.ts's `renderTree` (selection-centering scroll
 * math and all) — kept separate from the component so it stays plain-function testable. */
export function treeRows(
  state: TuiState,
  contentRows: number,
  cols: number,
): { content: string[]; hint: string } {
  const flat = flattenTree(state.tree ?? []);
  const selectedIndex = state.view.kind === "tree" ? state.view.selectedIndex : -1;
  if (flat.length === 0) {
    return {
      content: ["No agents yet."],
      hint: state.statusMessage ?? dim("[↑/↓] navigate   [Enter] open   [Esc] back"),
    };
  }
  const entryTexts = flat.map((entry, index) => {
    const marker = index === selectedIndex ? "> " : "  ";
    const glyph = colorizeStatus(entry.node.status, "●");
    const statusWord = colorizeStatus(entry.node.status, entry.node.status);
    const label = entry.node.description ?? `${entry.node.agentId} (${entry.node.model})`;
    const trackedAgent = state.agents.get(entry.node.agentId);
    const isActive = entry.node.status === "running" || entry.node.status === "waiting";
    const elapsed =
      trackedAgent === undefined || !isActive
        ? ""
        : `  [${formatElapsed(state.now - trackedAgent.statusSince)}]`;
    const tokens =
      trackedAgent === undefined
        ? ""
        : `  ${formatTokenCost(trackedAgent.inputTokens, trackedAgent.outputTokens, trackedAgent.costUsd)}`;
    return `${marker}${entry.prefix}${glyph} ${statusWord}  ${label}${elapsed}${tokens}`;
  });
  const entryLineRuns = entryTexts.map((text) => wrapText(text, cols));
  const allLines: string[] = [];
  const entryStartLine: number[] = [];
  for (const run of entryLineRuns) {
    entryStartLine.push(allLines.length);
    allLines.push(...run);
  }
  const maxScroll = Math.max(0, allLines.length - contentRows);
  const selectedStart = entryStartLine[selectedIndex] ?? 0;
  const scrollTop = Math.min(maxScroll, Math.max(0, selectedStart - Math.floor(contentRows / 2)));
  const content = allLines.slice(scrollTop, scrollTop + contentRows);
  return { content, hint: state.statusMessage ?? "[↑/↓] navigate   [Enter] open   [Esc] back" };
}

export interface AgentTreeProps {
  state: TuiState;
  contentRows: number;
  cols: number;
}

export function AgentTree({ state, contentRows, cols }: AgentTreeProps) {
  const { content, hint } = treeRows(state, contentRows, cols);
  const padded = content.slice(0, contentRows);
  while (padded.length < contentRows) padded.push("");
  return (
    <Box flexDirection="column">
      {padded.map((row, index) => {
        const rowKey = index;
        return row === "" ? <Box key={rowKey} height={1} /> : <Text key={rowKey}>{row}</Text>;
      })}
      <Text>{hint}</Text>
    </Box>
  );
}
