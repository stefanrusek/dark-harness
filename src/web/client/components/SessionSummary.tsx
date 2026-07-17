// React migration of render.ts's renderSessionSummary (DH-0135).
import type { ReactElement } from "react";
import { formatCostUsd, formatExitCode, formatTokenCount } from "../format.ts";
import { type WebState, sessionTotals } from "../state.ts";

export interface SessionSummaryProps {
  state: WebState;
}

export function SessionSummary({ state }: SessionSummaryProps): ReactElement {
  const totals = sessionTotals(state);
  return (
    <div className="session-summary">
      <div className="session-stats">
        {`${formatTokenCount(totals.inputTokens)} in / ${formatTokenCount(
          totals.outputTokens,
        )} out · ${formatCostUsd(totals.costUsd)}`}
      </div>
      {state.sessionEnded && state.exitCode !== null ? (
        <div
          className={`session-banner ${state.exitCode === 0 ? "session-banner-ok" : "session-banner-fail"}`}
        >
          {`Session ended — ${formatExitCode(state.exitCode)}`}
        </div>
      ) : null}
    </div>
  );
}
