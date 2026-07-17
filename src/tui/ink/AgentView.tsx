// DH-0136: single-agent detail (read-only) view, ported from render.ts's `renderAgent`.
import { Box, Text } from "ink";
import type { TuiState } from "../types.ts";
import { TranscriptPane } from "./TranscriptPane.tsx";
import { colorizeStatus, dim, formatElapsed, formatTokenCost } from "./tokens.ts";

export interface AgentViewProps {
  state: TuiState;
  contentRows: number;
  cols: number;
}

export function AgentView({ state, contentRows, cols }: AgentViewProps) {
  if (state.view.kind !== "agent") return null;
  const agent = state.agents.get(state.view.agentId) ?? null;
  const meta = agent
    ? `Model: ${agent.model}   Status: ${colorizeStatus(agent.status, agent.status)}` +
      ` (${formatElapsed(state.now - agent.statusSince)})` +
      `   Last event: ${formatElapsed(state.now - agent.lastEventAt)} ago` +
      `   ${formatTokenCost(agent.inputTokens, agent.outputTokens, agent.costUsd, "full")}`
    : "Model: (unknown)";
  const hint = state.statusMessage ?? `${meta}   —   ${dim("[Esc] back to root (read-only)")}`;
  return (
    <Box flexDirection="column">
      <TranscriptPane
        transcript={agent?.transcript ?? []}
        cols={cols}
        height={contentRows}
        emptyText="(no output yet)"
      />
      <Text>{hint}</Text>
    </Box>
  );
}
