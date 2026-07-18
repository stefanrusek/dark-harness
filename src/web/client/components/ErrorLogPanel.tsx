// React migration of render.ts's renderErrorLog (DH-0135).
import type { ReactElement } from "react";
import type { WebState } from "../state.ts";

export interface ErrorLogPanelProps {
  state: WebState;
}

export function ErrorLogPanel({ state }: ErrorLogPanelProps): ReactElement {
  const entries = [...state.errorLog].reverse();
  return (
    <details className={`error-log-panel${entries.length === 0 ? " hidden" : ""}`}>
      <summary className="error-log-summary">Errors</summary>
      <ul className="error-log-list" role="log">
        {entries.map((entry) => (
          <li className="error-log-entry" key={entry.id}>
            <span className="error-log-time">{new Date(entry.timestamp).toLocaleTimeString()}</span>
            <span className="error-log-message">{entry.message}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
