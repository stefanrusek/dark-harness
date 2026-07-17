// DH-0136: root view (single agent's transcript + the always-editable composer beneath it),
// ported from render.ts's `renderRoot`.
import { Box } from "ink";
import type { TuiState } from "../types.ts";
import { Composer } from "./Composer.tsx";
import { TranscriptPane } from "./TranscriptPane.tsx";
import type { ScrollBus } from "./scroll-bus.ts";
import { rootAgent } from "./tokens.ts";

export interface RootViewProps {
  state: TuiState;
  contentRows: number;
  cols: number;
  scrollBus?: ScrollBus;
}

export function RootView({ state, contentRows, cols, scrollBus }: RootViewProps) {
  const agent = rootAgent(state);
  return (
    <Box flexDirection="column">
      <TranscriptPane
        transcript={agent?.transcript ?? []}
        cols={cols}
        height={contentRows}
        emptyText="Waiting for root agent to start…"
        {...(scrollBus ? { scrollBus } : {})}
      />
      <Box paddingLeft={1}>
        <Composer state={state} />
      </Box>
    </Box>
  );
}
