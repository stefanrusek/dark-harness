// DH-0136/DH-0122: reserved `<Header>` slot per Muriel's design pass (docs/design/
// style-guide.md §5) — positioned above the agent tree/transcript in the Ink component tree.
// DH-0122 fills the `"full"` variant with the app's version/build identity, sourced from
// `header-info.ts` (the same shared builder CLI's `printAppHeader` and Web's `<AppHeader>`
// use), kept to one dim row so it doesn't eat into the already height-constrained terminal
// view alongside `<TitleBar>`. No `dh.json` config-status line here: the TUI client only
// ever knows a `baseUrl`/token (see `startTui` in src/tui/app.ts), never the config that
// produced them — including for a `--connect`ed remote server, which has no local `dh.json`
// at all — so that summary is printed once, up front, by the CLI's own startup header
// (`printAppHeader`, src/cli.ts) instead. DH-0224 update: DH-0124's pre-first-message empty
// state was ultimately built elsewhere — `RootView.buildRootEmptyText` (src/tui/ink/
// RootView.tsx), which renders the shared `formatEmptyStateLines` content as the transcript
// pane's empty text, not through this component. No caller passes `variant: "empty"` to
// `<Header>`; it stays a deliberate zero-row render, kept only so the prop's type accepts
// both variants without every call site needing a cast.
import { Text } from "ink";
import { BUILD_INFO } from "../../config/build-info.ts";
import { formatVersionString } from "../../header-info.ts";
import type { AgentInfo } from "../types.type.ts";
import { dim } from "./tokens.ts";

export interface HeaderProps {
  agentState?: AgentInfo | null;
  dhConfig?: unknown;
  variant: "full" | "empty";
}

/** `variant: "full"` (DH-0122) renders a single dim version/build-identity line;
 * `variant: "empty"` stays a zero-row render — see this file's header comment (DH-0224) for
 * why that's a deliberate contract, not a placeholder omission. */
export function Header({ variant }: HeaderProps) {
  if (variant !== "full") return null;
  return <Text>{dim(formatVersionString(BUILD_INFO))}</Text>;
}
