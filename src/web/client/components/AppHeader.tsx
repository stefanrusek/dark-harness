// DH-0135/DH-0122: `<AppHeader>` slot mounted at the top of the page, above the transcript
// (docs/design/style-guide.md §5's "startup blocks read as a panel" convention). Renders the
// app name, version/build identity, and `dh.json` config-status summary — sourced from
// `header-info.ts` (the same shared builder the CLI's startup block and TUI's `<Header>`
// use) via `headerInfo`, fetched once at boot from `WEB_CONFIG_PATH` (main.ts) and threaded
// straight through (app.ts -> App.tsx) rather than through `WebState`, since it's static for
// the process lifetime. `headerInfo` is `undefined` only in tests that don't supply it (or a
// client boot that predates this field) — renders nothing in that case, same contract as
// before this ticket.
import type { ReactElement } from "react";
import type { HeaderInfo } from "../../../header-info.ts";
import { formatConfigStatusLine, formatVersionString } from "../../../header-info.ts";

export interface AppHeaderProps {
  headerInfo?: HeaderInfo;
}

export function AppHeader({ headerInfo }: AppHeaderProps): ReactElement | null {
  if (!headerInfo) return null;
  return (
    <div className="app-header">
      <span className="app-header-logo">{headerInfo.logoCompact}</span>
      <span className="app-header-version">{formatVersionString(headerInfo.build)}</span>
      <span className="app-header-config">{formatConfigStatusLine(headerInfo.config)}</span>
    </div>
  );
}
