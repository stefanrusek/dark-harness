// DH-0136: single-agent detail (read-only) view, ported from render.ts's `renderAgent`.
import { Box, Text } from "ink";
import type { TuiState } from "../types.type.ts";
import type { ScrollBus } from "./scroll-bus.ts";
import { TranscriptPane } from "./TranscriptPane.tsx";
import { colorizeStatus, dim, formatElapsed, formatTokenCost } from "./tokens.ts";
import type { ToolFocusBus } from "./tool-focus-bus.ts";

export interface AgentViewProps {
  state: TuiState;
  contentRows: number;
  cols: number;
  scrollBus?: ScrollBus;
  /** DH-0246: threaded straight through to `<TranscriptPane>` — see its own prop doc comment. */
  toolFocusBus?: ToolFocusBus;
}

export function AgentView({ state, contentRows, cols, scrollBus, toolFocusBus }: AgentViewProps) {
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
        {...(scrollBus ? { scrollBus } : {})}
        {...(toolFocusBus ? { toolFocusBus } : {})}
      />
      <Text>{hint}</Text>
    </Box>
  );
}
