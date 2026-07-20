// DH-0135/DH-0122/DH-0248: `<AppHeader>` renders the masthead mounted at the top of the page,
// above the transcript (docs/design/style-guide.md §5's "startup blocks read as a panel"
// convention; §6.2's "brand-launch moment" convention for the masthead upgrade itself). Three
// zones, left to right: brand (`<LogoMark>` + gradient "Dark Harness" wordmark), build
// (version/build identity), and a right-aligned row of config-instrument chips. Sourced from
// `header-info.ts` (the same shared builder the CLI's startup block and TUI's `<Header>` use)
// via `headerInfo`, fetched once at boot from `WEB_CONFIG_PATH` (main.ts) and threaded straight
// through (app.ts -> App.tsx) rather than through `WebState`, since it's static for the process
// lifetime. `headerInfo` is `undefined` only in tests that don't supply it (or a client boot
// that predates this field) — renders nothing in that case, same contract as before this
// ticket.
//
// DH-0248: this masthead lives in the fixed `.app-header-slot` grid area (`App.tsx`, grid area
// `header`, sized `auto`) and must never move into `Transcript.tsx`'s `.output-scroll` region —
// see style-guide §6.2: the Web's native brand-launch idiom is a persistent, non-scrolling
// masthead, deliberately NOT a port of the TUI's DH-0245 scroll-into-transcript mechanic (that
// was a workaround for Ink's alt-screen wipe, which the Web has no equivalent of).
import type { ReactElement } from "react";
import type { ConfigStatusSummary, HeaderInfo } from "../../../header-info.ts";
import { formatVersionString } from "../../../header-info.ts";
import { LogoMark } from "./LogoMark.tsx";

export interface AppHeaderProps {
  headerInfo?: HeaderInfo;
}

/** The config-instrument chip row: every fact `formatConfigStatusLine` renders, broken out
 * into discrete labeled chips instead of one ellipsized string — `config <path>` + model
 * count, `bind <host>`, an auth chip (neutral `token required` or warning-accent `⚠ no
 * token`), and a `tls on` chip iff `hasTls`. */
function ConfigChips({ config }: { config: ConfigStatusSummary }): ReactElement {
  if (!config.exists) {
    return (
      <div className="header-chips">
        <span className="header-chip">config: not found ({config.path})</span>
      </div>
    );
  }
  const modelCount = `${config.modelCount} model${config.modelCount === 1 ? "" : "s"}`;
  return (
    <div className="header-chips">
      <span className="header-chip">
        config {config.path} · {modelCount}
      </span>
      <span className="header-chip">bind {config.hostname ?? "all interfaces"}</span>
      {config.hasToken ? (
        <span className="header-chip">token required</span>
      ) : (
        <span className="header-chip header-chip-warn">⚠ no token</span>
      )}
      {config.hasTls ? <span className="header-chip">tls on</span> : null}
    </div>
  );
}

export function AppHeader({ headerInfo }: AppHeaderProps): ReactElement | null {
  if (!headerInfo) return null;
  return (
    <div className="app-header">
      <div className="app-header-brand">
        <LogoMark className="app-header-mark" />
        <span className="app-header-wordmark">Dark Harness</span>
      </div>
      <span className="app-header-version">{formatVersionString(headerInfo.build)}</span>
      <ConfigChips config={headerInfo.config} />
    </div>
  );
}
