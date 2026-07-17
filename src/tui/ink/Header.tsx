// DH-0136: reserved `<Header>` slot per Muriel's design pass (docs/design/style-guide.md
// §5) — positioned above the agent tree/transcript in the Ink component tree so DH-0122's
// full startup header and DH-0124's lighter empty-state variant can slot in later without
// restructuring the tree. Both `variant`s are TODO content-wise until those tickets land;
// this component deliberately renders zero rows in the meantime (no placeholder text, no
// blank reserved lines) so it doesn't eat vertical space in an already height-constrained
// terminal view.
import type { AgentInfo } from "../types.ts";

export interface HeaderProps {
  agentState?: AgentInfo | null;
  dhConfig?: unknown;
  variant: "full" | "empty";
}

/** Renders nothing until DH-0122 (`variant: "full"`) / DH-0124 (`variant: "empty"`) land —
 * see this file's header comment for why an empty render is the deliberate contract, not a
 * placeholder omission. */
export function Header(_props: HeaderProps): null {
  return null;
}
