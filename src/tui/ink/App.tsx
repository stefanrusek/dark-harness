// DH-0136: Ink root component. Every view (root/composer, agent tree, agent detail, model
// picker) now renders through real Ink components — this file no longer depends on render.ts,
// which has been deleted; its pure helpers were ported into tokens.ts/TitleBar.tsx/
// AgentTree.tsx/AgentView.tsx/PickerView.tsx/RootView.tsx/TranscriptPane.tsx. `app.ts` owns
// only the SSE subscription plus raw-mode/alt-screen lifecycle plus mounting this component.
import { Box } from "ink";
import type { TuiState } from "../types.ts";
import { AgentTree } from "./AgentTree.tsx";
import { AgentView } from "./AgentView.tsx";
import { Header } from "./Header.tsx";
import { PickerView } from "./PickerView.tsx";
import { RootView } from "./RootView.tsx";
import { StatusRow } from "./StatusRow.tsx";
import { TitleBar } from "./TitleBar.tsx";

export interface AppProps {
  state: TuiState;
}

const HEADER_ROWS = 2;
const MARGIN = 1;
// DH-0125: StatusRow now renders one real line (model / progress / git branch+cwd) instead
// of DH-0136's placeholder zero rows — content height must shrink by this much to keep the
// frame's total row count matching the terminal exactly (App.test.tsx's frame-height checks).
const STATUS_ROW_ROWS = 1;

export function App({ state }: AppProps) {
  const { rows, cols } = state.size;
  const innerCols = Math.max(1, cols - 2 * MARGIN);
  const footerRows = state.view.kind === "root" ? 2 : 1;
  const contentRows = Math.max(0, rows - HEADER_ROWS - footerRows - STATUS_ROW_ROWS);
  const rootAgentInfo = state.rootAgentId ? (state.agents.get(state.rootAgentId) ?? null) : null;

  return (
    <Box flexDirection="column" paddingLeft={MARGIN}>
      <TitleBar state={state} cols={innerCols} />
      {state.view.kind === "root" && (
        <RootView state={state} contentRows={contentRows} cols={innerCols} />
      )}
      {state.view.kind === "tree" && (
        <AgentTree state={state} contentRows={contentRows} cols={innerCols} />
      )}
      {state.view.kind === "agent" && (
        <AgentView state={state} contentRows={contentRows} cols={innerCols} />
      )}
      {state.view.kind === "picker" && (
        <PickerView state={state} contentRows={contentRows} cols={innerCols} />
      )}
      <Header variant="full" agentState={rootAgentInfo} />
      <StatusRow agentState={rootAgentInfo} now={state.now} />
    </Box>
  );
}
