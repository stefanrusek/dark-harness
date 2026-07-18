// React migration of render.ts's renderAgentHeader (DH-0135). Named `AgentHeaderPanel` (not
// `AgentHeader`) to avoid colliding with the reserved `<AppHeader>` slot (components/AppHeader.tsx).
import type { ReactElement } from "react";
import { STATUS_TOKENS } from "../../../design-tokens.ts";
import { formatCostUsd, formatStatusElapsed, formatTokenCount, shortAgentId } from "../format.ts";
import { isRoot, selectedAgent, type WebState } from "../state.ts";

export interface AgentHeaderPanelProps {
  state: WebState;
  onDownloadAgentLog: (agentId: string) => void;
  onDownloadSessionBundle: () => void;
  onStopAgent: (agentId: string) => void;
  now?: number;
}

export function AgentHeaderPanel({
  state,
  onDownloadAgentLog,
  onDownloadSessionBundle,
  onStopAgent,
  now = Date.now(),
}: AgentHeaderPanelProps): ReactElement {
  const agent = selectedAgent(state);
  if (!agent) {
    return <div className="empty-state">Waiting for an agent to spawn…</div>;
  }

  const token = STATUS_TOKENS[agent.status];
  const name = isRoot(state, agent.agentId)
    ? "Root agent"
    : (agent.description ?? `${agent.model || "agent"} (${shortAgentId(agent.agentId)})`);
  const canStop = agent.status === "running" || agent.status === "waiting";

  return (
    <>
      <div className="agent-header-title">
        <span className={`status-dot status-${agent.status}`} />
        <span className="agent-header-name">{name}</span>
        <span className="agent-header-model" title="Active model — /model to switch">
          {agent.model || "(unknown model)"}
        </span>
        <span className={`status-badge status-${agent.status}`}>{token.word}</span>
        <span
          className="status-elapsed"
          title='Time since this agent last changed status — helps tell "still thinking" from "stalled" during a long turn'
        >
          {formatStatusElapsed(now - Date.parse(agent.statusSince))}
        </span>
      </div>
      <div className="agent-header-stats">
        {`${formatTokenCount(agent.inputTokens)} in / ${formatTokenCount(
          agent.outputTokens,
        )} out · ${formatCostUsd(agent.hasCost ? agent.costUsd : null)}`}
      </div>
      <div className="agent-header-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => onDownloadAgentLog(agent.agentId)}
        >
          Download log
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => onDownloadSessionBundle()}
        >
          Download session bundle
        </button>
        {canStop ? (
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => onStopAgent(agent.agentId)}
          >
            Stop
          </button>
        ) : null}
      </div>
    </>
  );
}
