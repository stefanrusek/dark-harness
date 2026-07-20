// DH-0136: the only file that value-imports "react"/"ink" on app.ts's behalf — kept separate
// so app.ts's own `StdinLike`/`StdoutLike` (the test-fakeable I/O surface it already exposes)
// don't have to satisfy Ink's real `WriteStream`/`ReadStream` shape; this file takes them as
// `unknown` and casts internally instead. (An earlier version of this file tried a type-erased
// *dynamic* `import()` from app.ts to keep react/ink's ambient types out of the root tsconfig
// program entirely — reverted: `bun build --compile` can't statically bundle a non-literal
// dynamic import, so that approach silently produced a binary that threw `Cannot find module`
// at runtime. The real fix is the root tsconfig now enabling `jsx` and
// e2e/spikes/web/spike-reconnect.ts's two-line fix for the resulting DOM-lib collision — see
// tsconfig.json's comment.)
import { render as inkRender } from "ink";
import React from "react";
import type { TuiState } from "../types.type.ts";
import { App } from "./App.tsx";
import type { RootViewHeader } from "./RootView.tsx";
import type { ScrollBus } from "./scroll-bus.ts";

export interface InkMount {
  rerender(state: TuiState): void;
  unmount(): void;
}

/** Mount the Ink root component against real (or fake, in tests) stdio. No component in the
 * tree calls Ink's own `useInput`/`usePaste`, so this does not touch stdin raw-mode — that
 * stays owned by app.ts's own `stdin.on("data", ...)` wiring, unchanged by this migration.
 * `scrollBus` (DH-0126) is optional so existing test callers don't need to supply one.
 * `header` (DH-0245) is likewise optional and, when supplied, is the same object on every
 * subsequent `rerender` — it's static for the life of one session (the facts/colorLevel
 * `run.ts` resolved once at startup), so it's captured here rather than threaded back through
 * `state`. */
export function mountInk(
  state: TuiState,
  stdout: unknown,
  stdin: unknown,
  scrollBus?: ScrollBus,
  header?: RootViewHeader,
): InkMount {
  // Ink's `render()` wants a real Node `WriteStream`/`ReadStream`; callers (app.ts) pass its
  // own minimal test-fakeable `StdoutLike`/`StdinLike` instead.
  // biome-ignore lint/suspicious/noExplicitAny: see comment above.
  const inkStdout = stdout as any;
  // biome-ignore lint/suspicious/noExplicitAny: see comment above.
  const inkStdin = stdin as any;
  const props = (s: TuiState) => ({
    state: s,
    ...(scrollBus ? { scrollBus } : {}),
    ...(header ? { header } : {}),
  });
  const instance = inkRender(React.createElement(App, props(state)), {
    stdout: inkStdout,
    stdin: inkStdin,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return {
    rerender(next: TuiState) {
      instance.rerender(React.createElement(App, props(next)));
    },
    unmount() {
      instance.unmount();
    },
  };
}
