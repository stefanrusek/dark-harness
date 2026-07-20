// DH-0136: root view (single agent's transcript + the always-editable composer beneath it),
// ported from render.ts's `renderRoot`.
import { Box } from "ink";
import type { HeaderStatusFacts } from "../../cli/header.ts";
import { renderHeaderA2 } from "../../cli/header.ts";
import type { ColorLevel } from "../../design-tokens.ts";
import type { TuiState } from "../types.type.ts";
import { Composer } from "./Composer.tsx";
import type { ScrollBus } from "./scroll-bus.ts";
import { TranscriptPane } from "./TranscriptPane.tsx";
import { rootAgent } from "./tokens.ts";

/** DH-0245: the real in-session Header A2 content — sourced from `header`'s
 * facts/colorLevel (threaded down from `run.ts`'s own `detectColorLevel`/`HeaderStatusFacts`
 * via `App`/`mountInk`/`startTui`) through the exact same `renderHeaderA2` the pre-mount
 * stdout print uses, never a second/independently-drifting implementation. Undefined when no
 * `header` prop was supplied (e.g. a standalone `<RootView>` test that isn't exercising this
 * feature) — `TranscriptPane` treats an absent/empty `headerLines` as "nothing to prepend".
 */
export interface RootViewHeader {
  facts: HeaderStatusFacts;
  level: ColorLevel;
}

export interface RootViewProps {
  state: TuiState;
  contentRows: number;
  cols: number;
  scrollBus?: ScrollBus;
  header?: RootViewHeader;
}

/** DH-0124/DH-0245: pre-first-message empty-state hint. The app-identity banner itself
 * (wordmark/version/status tree, in real color when available) now lives in `RootView`'s
 * `headerLines` (via `renderHeaderA2`, `TranscriptPane`'s synthetic leading rows) — this is
 * just the trailing "type something" nudge shown while the transcript is still empty, kept
 * separate so it disappears once the first turn lands while the banner above it persists. */
export function buildRootEmptyText(): string {
  return "Type a message below to get started.";
}

export function RootView({ state, contentRows, cols, scrollBus, header }: RootViewProps) {
  const agent = rootAgent(state);
  const headerLines = header
    ? renderHeaderA2(header.facts, header.level, {
        columns: state.size.cols,
        rows: state.size.rows,
      })
    : undefined;
  return (
    <Box flexDirection="column">
      <TranscriptPane
        transcript={agent?.transcript ?? []}
        cols={cols}
        height={contentRows}
        emptyText={buildRootEmptyText()}
        {...(headerLines ? { headerLines } : {})}
        {...(scrollBus ? { scrollBus } : {})}
      />
      <Box paddingLeft={1}>
        <Composer state={state} cols={Math.max(1, cols - 1)} />
      </Box>
    </Box>
  );
}
