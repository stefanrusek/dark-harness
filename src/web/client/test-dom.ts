// Test-only helper: a headless DOM via happy-dom, cast to the standard lib.dom types so it
// can be passed anywhere production code expects a real `Document`/`HTMLElement`. Kept out
// of the render/app modules themselves so production code never depends on happy-dom.

import { Window } from "happy-dom";

// DH-0135: `bun test` doesn't strictly finish one file's tests before starting another's —
// several files can have test bodies in flight in the same process at once — so toggling
// `globalThis.window`/`document` on and off per-test (set at the top of a test, deleted at
// the end) is observable by an unrelated concurrently-running test in a half-registered
// state. Registering once, at module load, for the lifetime of the whole `bun test` process
// avoids that race entirely — `react-dom` (mounted for the Composer/AppHeader sections, see
// app.ts) only needs `window`/`document` to exist as *some* object for its few ambient reads
// (e.g. `getCurrentEventPriority`'s `window.event`); each individual test still gets its own
// isolated happy-dom `Window`/`Document`/root threaded through explicitly via `createTestDom`
// below, which is what actually determines what gets rendered where.
//
// The one thing that must NOT become ambiently true for the whole process is "looks like a
// browser": the Anthropic SDK's `isRunningInBrowser()` (src/agent/providers/anthropic.ts)
// checks `window`/`window.document`/`navigator` together and throws once all three are
// present — Bun itself always provides a real `navigator`, so `navigator` is overridden to
// `undefined` here too, permanently, alongside `window`/`document`.
const globalAny = globalThis as unknown as Record<string, unknown>;
if (!globalAny.window) {
  const bootWindow = new Window({ url: "http://localhost/" });
  globalAny.window = bootWindow;
  globalAny.document = bootWindow.document;
  globalAny.HTMLElement = bootWindow.HTMLElement;
  globalAny.navigator = undefined;
}

export interface TestDom {
  window: Window;
  document: Document;
  root: HTMLElement;
  /**
   * Dispatches a happy-dom-native event on `target`. happy-dom's `dispatchEvent` checks
   * `instanceof` its *own* realm's `Event` class, so events must be constructed via
   * `window.Event`/`window.KeyboardEvent` rather than the ambient global — using the global
   * constructor throws inside happy-dom instead of just failing the `instanceof` check.
   */
  dispatch(target: EventTarget, type: string, init?: EventInit): void;
  dispatchKey(target: EventTarget, type: string, init: KeyboardEventInit): void;
}

export function createTestDom(): TestDom {
  const window = new Window({ url: "http://localhost/" });
  const document = window.document as unknown as Document;
  const root = document.createElement("div") as unknown as HTMLElement;
  (document.body as unknown as HTMLElement).appendChild(root);

  const windowAny = window as unknown as {
    Event: new (type: string, init?: EventInit) => Event;
    KeyboardEvent: new (type: string, init?: KeyboardEventInit) => Event;
  };

  return {
    window,
    document,
    root,
    dispatch: (target, type, init) => {
      target.dispatchEvent(new windowAny.Event(type, { bubbles: true, ...init }));
    },
    dispatchKey: (target, type, init) => {
      target.dispatchEvent(new windowAny.KeyboardEvent(type, { bubbles: true, ...init }));
    },
  };
}
