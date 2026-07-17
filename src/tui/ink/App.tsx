// DH-0136: Ink root component. Root view/composer is the first view migrated to real Ink
// components (Composer below); the agent tree/agent-detail/model-picker views still render
// through render.ts's existing pure `TuiState -> string[]` functions for now (agent tree +
// transcript pane + DH-0126's scroll-viewport remainder are the next migration phases per
// this ticket's Functional Requirements) — reused here as plain `<Text>` rows rather than
// duplicated. This still fully replaces `app.ts`'s old `frameToAnsi`/`stdout.write` path: Ink
// is the single write mechanism for every view, so there is no double-write / mixed-frame
// period at the process level even though the tree/transcript aren't componentized yet.
import { Box, Text } from "ink";
import { renderFrame } from "../render.ts";
import type { TuiState } from "../types.ts";
import { Composer } from "./Composer.tsx";
import { Header } from "./Header.tsx";
import { StatusRow } from "./StatusRow.tsx";

export interface AppProps {
  state: TuiState;
}

export function App({ state }: AppProps) {
  const frame = renderFrame(state);
  // Root view's last two rows are the footer (hint + input line) that `<Composer>` now owns
  // directly, prop-driven off `state` instead of pre-formatted strings — see Composer.tsx.
  // Every other view's footer (a single hint line) stays plain text for now.
  const footerRowCount = state.view.kind === "root" ? 2 : 0;
  const bodyRows = footerRowCount > 0 ? frame.slice(0, frame.length - footerRowCount) : frame;
  const rootAgentInfo = state.rootAgentId ? (state.agents.get(state.rootAgentId) ?? null) : null;

  return (
    <Box flexDirection="column">
      {bodyRows.map((row, index) => {
        // Rows are a fixed-height positional frame, not a keyed/reorderable list — index is
        // the correct identity here.
        const rowKey = index;
        // Ink's `<Text>` collapses to zero height for an empty-string child (unlike the old
        // `frameToAnsi`, which always emitted every row) — an explicit `height={1}` wrapper
        // keeps a blank row (a transcript separator, or bottom padding) occupying one line,
        // matching `renderFrame`'s exact-height contract. Non-empty rows skip the fixed
        // height: some rows (e.g. `renderAgent`'s footer hint) aren't pre-wrapped to
        // `innerCols` the way most rows are, and a hard `height={1}` would silently clip an
        // overflowing one instead of letting Ink wrap it — same "may overflow on a narrow
        // terminal" behavior the old raw-ANSI renderer always had, just handled by Ink's
        // layout instead of the physical terminal.
        if (row === "") {
          return <Box key={rowKey} height={1} />;
        }
        return <Text key={rowKey}>{row}</Text>;
      })}
      <Header variant="full" agentState={rootAgentInfo} />
      {state.view.kind === "root" && (
        <Box paddingLeft={1}>
          <Composer state={state} />
        </Box>
      )}
      <StatusRow agentState={rootAgentInfo} />
    </Box>
  );
}
