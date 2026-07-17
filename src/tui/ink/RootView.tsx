// DH-0136: root view (single agent's transcript + the always-editable composer beneath it),
// ported from render.ts's `renderRoot`.
import { Box } from "ink";
import { BUILD_INFO } from "../../config/build-info.ts";
import { buildHeaderInfo, formatEmptyStateLines } from "../../header-info.ts";
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

/** DH-0124: pre-first-message empty state. Replaces the old "Waiting for root agent to
 * start…" text, which read as if the harness itself hadn't come up yet — it's really just
 * waiting on the operator's first message. `config: null` because the TUI client never knows
 * the server's `dh.json` (see Header.tsx's header comment) — `formatEmptyStateLines` doesn't
 * use it anyway (no config-status line in this lighter variant). */
export function buildRootEmptyText(): string {
  const info = buildHeaderInfo(null, "", BUILD_INFO);
  return [...formatEmptyStateLines(info), "", "Type a message below to get started."].join("\n");
}

export function RootView({ state, contentRows, cols, scrollBus }: RootViewProps) {
  const agent = rootAgent(state);
  return (
    <Box flexDirection="column">
      <TranscriptPane
        transcript={agent?.transcript ?? []}
        cols={cols}
        height={contentRows}
        emptyText={buildRootEmptyText()}
        {...(scrollBus ? { scrollBus } : {})}
      />
      <Box paddingLeft={1}>
        <Composer state={state} />
      </Box>
    </Box>
  );
}
