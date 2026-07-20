// React migration of render.ts's renderSidebar (DH-0135). Status dot color/glyph now comes
// from DH-0137's shared STATUS_TOKENS instead of a locally-declared status-to-color map.
import type { CSSProperties, ReactElement } from "react";
import { STATUS_TOKENS } from "../../../design-tokens.ts";
import { formatElapsed, formatTokenLabel, shortAgentId } from "../format.ts";
import { agentDepth, isRoot, orderedAgents, type WebState } from "../state.ts";

const SIDEBAR_INDENT_PX = 16;

export interface SidebarProps {
  state: WebState;
  onSelect: (agentId: string) => void;
  now?: number;
}

export function Sidebar({ state, onSelect, now = Date.now() }: SidebarProps): ReactElement {
  return (
    <div className="sidebar-tree">
      <div className="agent-tree" role="listbox" aria-label="Agents" tabIndex={-1}>
        {orderedAgents(state).map((agent) => {
          const token = STATUS_TOKENS[agent.status];
          const selected = agent.agentId === state.selectedAgentId;
          const root = isRoot(state, agent.agentId);
          const depth = agentDepth(state, agent.agentId);
          const style: CSSProperties | undefined =
            depth > 0
              ? { paddingLeft: `calc(var(--space-2) + ${depth * SIDEBAR_INDENT_PX}px)` }
              : undefined;
          const label = root
            ? "root"
            : (agent.description ?? `${agent.model || "agent"} · ${shortAgentId(agent.agentId)}`);
          const select = () => onSelect(agent.agentId);

          return (
            <div
              key={agent.agentId}
              className={`agent-row${selected ? " selected" : ""}${root ? " root" : ""}`}
              data-agent-id={agent.agentId}
              data-status={agent.status}
              role="option"
              tabIndex={0}
              aria-selected={selected}
              style={style}
              aria-label={`${root ? "root" : (agent.description ?? (agent.model || "agent"))}, status: ${token.word}`}
              onClick={select}
              onKeyDown={(evt) => {
                if (evt.key === "Enter" || evt.key === " ") {
                  evt.preventDefault();
                  select();
                }
              }}
            >
              <span
                className={`status-dot status-${agent.status}`}
                title={token.word}
                aria-hidden="true"
              />
              <span className="agent-label">{label}</span>
              <span className="agent-elapsed" title={`Time in "${token.word}"`}>
                {formatElapsed(now - Date.parse(agent.statusSince))}
              </span>
              <span className="agent-tokens">
                {formatTokenLabel(agent.inputTokens + agent.outputTokens)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
