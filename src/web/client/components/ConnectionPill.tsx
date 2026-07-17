// React migration of render.ts's renderConnectionStatus (DH-0135). Looks up the label via
// DH-0137's shared CONNECTION_TOKENS rather than a locally-declared status-to-label map.
import type { ReactElement } from "react";
import { CONNECTION_TOKENS } from "../../../design-tokens.ts";
import type { ConnectionStatus } from "../state.ts";

export interface ConnectionPillProps {
  status: ConnectionStatus;
}

export function ConnectionPill({ status }: ConnectionPillProps): ReactElement {
  const token = CONNECTION_TOKENS[status];
  return (
    <output className={`connection-pill connection-${status}`} aria-live="polite">
      {token.webLabel}
    </output>
  );
}
