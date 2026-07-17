// DH-0135: top-level React composition. Owns the whole page's DOM — app.ts renders this
// once per state change via a single `react-dom` root, replacing render.ts's hand-written
// `buildShell` + per-section imperative render functions.
import type { ReactElement } from "react";
import { type WebState, selectedAgent } from "../state.ts";
import { AgentHeaderPanel } from "./AgentHeaderPanel.tsx";
import { AppHeader } from "./AppHeader.tsx";
import { Composer } from "./Composer.tsx";
import { ConnectionPill } from "./ConnectionPill.tsx";
import { ErrorBanner } from "./ErrorBanner.tsx";
import { ErrorLogPanel } from "./ErrorLogPanel.tsx";
import { GapBanner } from "./GapBanner.tsx";
import { ModelPicker } from "./ModelPicker.tsx";
import { SessionSummary } from "./SessionSummary.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { Transcript } from "./Transcript.tsx";

export interface AppProps {
  state: WebState;
  now: number;
  errorMessage: string | null;
  onSelectAgent: (agentId: string) => void;
  onSendMessage: (message: string) => void;
  onDownloadAgentLog: (agentId: string) => void;
  onDownloadSessionBundle: () => void;
  onStopAgent: (agentId: string) => void;
  onSelectModel: (name: string) => void;
  onCloseModelPicker: () => void;
  onDismissGapBanner: () => void;
}

export function App({
  state,
  now,
  errorMessage,
  onSelectAgent,
  onSendMessage,
  onDownloadAgentLog,
  onDownloadSessionBundle,
  onStopAgent,
  onSelectModel,
  onCloseModelPicker,
  onDismissGapBanner,
}: AppProps): ReactElement {
  const agent = selectedAgent(state);

  return (
    <div className="dh-app">
      <div className="app-header-slot">
        <AppHeader />
      </div>
      <nav className="sidebar">
        <div className="brand">Dark Harness</div>
        <ConnectionPill status={state.connectionStatus} />
        <Sidebar state={state} onSelect={onSelectAgent} now={now} />
        <SessionSummary state={state} />
      </nav>
      <main className="main-pane">
        <div className="agent-header">
          <AgentHeaderPanel
            state={state}
            onDownloadAgentLog={onDownloadAgentLog}
            onDownloadSessionBundle={onDownloadSessionBundle}
            onStopAgent={onStopAgent}
            now={now}
          />
        </div>
        <Transcript agent={agent} sessionEnded={state.sessionEnded} exitCode={state.exitCode} />
        <div className="composer-region">
          <Composer state={state} onSend={onSendMessage} />
        </div>
        <GapBanner visible={state.possibleGap} onDismiss={onDismissGapBanner} />
        <ErrorBanner message={errorMessage} />
        <ErrorLogPanel state={state} />
      </main>
      <ModelPicker state={state} onSelect={onSelectModel} onClose={onCloseModelPicker} />
    </div>
  );
}
