// DH-0136: reserved `<StatusRow>` slot per DH-0125's explicit ask ("a row under the input
// box") — positioned directly under the composer. Field content (model/progress/git-branch)
// is DH-0125's own design work, not this ticket's; this component commits only to the slot's
// position and the "renders nothing until populated" contract (same convention as
// `<Header>`).
import type { AgentInfo } from "../types.ts";

export interface StatusRowProps {
  agentState?: AgentInfo | null;
  gitInfo?: unknown;
}

/** Renders nothing until DH-0125 lands and specifies field content. */
export function StatusRow(_props: StatusRowProps): null {
  return null;
}
