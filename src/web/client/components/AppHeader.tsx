// DH-0135: reserved `<AppHeader>` slot in the new React component tree, mounted at the top
// of the page above the transcript (docs/design/style-guide.md §5's "startup blocks read as
// a panel" convention). DH-0122 (not yet landed) owns filling this in with the app name,
// version/build, and dh.json config-status summary — until then it renders `null` so it adds
// no visible DOM, no layout shift, and reserves no unexpected height/margin. `AppHeaderProps`
// is this ticket's data contract for that future work: DH-0122 should only need to change
// this component's body, not `App`'s composition around it.
import type { ReactElement } from "react";

export interface AppHeaderProps {
  /** Placeholder for whatever slice of `WebState` DH-0122 ends up needing (connection/agent
   *  summary data). `null` until DH-0122 defines the real shape. */
  agentState?: unknown | null;
  /** Placeholder for the `dh.json` config-status summary DH-0122 will display. `null` until
   *  DH-0122 defines the real shape. */
  dhConfig?: unknown | null;
}

export function AppHeader(_props: AppHeaderProps): ReactElement | null {
  return null;
}
