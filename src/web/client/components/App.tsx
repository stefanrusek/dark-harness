// DH-0135: top-level React composition. Owns the whole page's DOM — app.ts renders this
// once per state change via a single `react-dom` root, replacing render.ts's hand-written
// `buildShell` + per-section imperative render functions.
import type { ReactElement } from "react";
import type { HeaderInfo } from "../../../header-info.ts";
import { selectedAgent, type WebState } from "../state.ts";
import { AgentHeaderPanel } from "./AgentHeaderPanel.tsx";
import { AppHeader } from "./AppHeader.tsx";
import { Composer } from "./Composer.tsx";
import { ConnectionPill } from "./ConnectionPill.tsx";
import { ErrorBanner } from "./ErrorBanner.tsx";
import { ErrorLogPanel } from "./ErrorLogPanel.tsx";
import { GapBanner } from "./GapBanner.tsx";
import { LogoMark } from "./LogoMark.tsx";
import { ModelPicker } from "./ModelPicker.tsx";
import { SessionSummary } from "./SessionSummary.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { Transcript } from "./Transcript.tsx";

export interface AppProps {
  state: WebState;
  headerInfo?: HeaderInfo;
  now: number;
  errorMessage: string | null;
  onSelectAgent: (agentId: string) => void;
  onSendMessage: (message: string) => void;
  onDownloadAgentLog: (agentId: string) => void;
  onDownloadSessionBundle: () => void;
  onStopAgent: (agentId: string) => void;
  onCancelQueuedMessage: (agentId: string, messageId: string) => void;
  onSelectModel: (name: string) => void;
  onCloseModelPicker: () => void;
  onDismissGapBanner: () => void;
}

export function App({
  state,
  headerInfo,
  now,
  errorMessage,
  onSelectAgent,
  onSendMessage,
  onDownloadAgentLog,
  onDownloadSessionBundle,
  onStopAgent,
  onCancelQueuedMessage,
  onSelectModel,
  onCloseModelPicker,
  onDismissGapBanner,
}: AppProps): ReactElement {
  const agent = selectedAgent(state);

  return (
    <div className="dh-app">
      <div className="app-header-slot">
        <AppHeader {...(headerInfo ? { headerInfo } : {})} />
      </div>
      <nav className="sidebar">
        {/* DH-0248: the masthead above now carries the "Dark Harness" wordmark at larger
            scale directly above the sidebar — keeping the literal text here too would stack
            two wordmarks. Keep the small mark as the nav's own identity anchor, drop the
            redundant text (Susan's non-gating taste call per the ticket). */}
        <div className="brand" role="img" aria-label="Dark Harness">
          <LogoMark className="brand-mark" />
        </div>
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
        <Transcript
          agent={agent}
          sessionEnded={state.sessionEnded}
          exitCode={state.exitCode}
          onCancelQueuedMessage={onCancelQueuedMessage}
        />
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
