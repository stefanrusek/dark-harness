// Test-only helper: a headless DOM via happy-dom, cast to the standard lib.dom types so it
// can be passed anywhere production code expects a real `Document`/`HTMLElement`. Kept out
// of the render/app modules themselves so production code never depends on happy-dom.

import { Window } from "happy-dom";

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
