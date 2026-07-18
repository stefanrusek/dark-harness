// Test-only helper: a headless DOM via happy-dom, cast to the standard lib.dom types so it
// can be passed anywhere production code expects a real `Document`/`HTMLElement`. Kept out
// of the render/app modules themselves so production code never depends on happy-dom.

import { afterAll, beforeAll } from "bun:test";
import { Window } from "happy-dom";

const TEST_DOM_GLOBALS_KEY = Symbol.for("dh.testDom.globals");

const globalAny = globalThis as typeof globalThis & {
  [TEST_DOM_GLOBALS_KEY]?: RegisteredGlobals;
  window?: unknown;
  document?: unknown;
  HTMLElement?: unknown;
  navigator?: unknown;
};

type RegisteredGlobals = {
  refs: number;
  windowPresent: boolean;
  windowValue: unknown;
  documentPresent: boolean;
  documentValue: unknown;
  htmlElementPresent: boolean;
  htmlElementValue: unknown;
  navigatorPresent: boolean;
  navigatorValue: unknown;
};

function getRegisteredGlobals(): RegisteredGlobals {
  let state = globalAny[TEST_DOM_GLOBALS_KEY];
  if (!state) {
    state = {
      refs: 0,
      windowPresent: Object.hasOwn(globalAny, "window"),
      windowValue: globalAny.window,
      documentPresent: Object.hasOwn(globalAny, "document"),
      documentValue: globalAny.document,
      htmlElementPresent: Object.hasOwn(globalAny, "HTMLElement"),
      htmlElementValue: globalAny.HTMLElement,
      navigatorPresent: Object.hasOwn(globalAny, "navigator"),
      navigatorValue: globalAny.navigator,
    };
    globalAny[TEST_DOM_GLOBALS_KEY] = state;
  }
  return state;
}

function restoreOrDelete(
  key: "window" | "document" | "HTMLElement" | "navigator",
  present: boolean,
  value: unknown,
): void {
  if (present) globalAny[key] = value;
  else delete globalAny[key];
}

function installDomGlobals(): void {
  const bootWindow = new Window({ url: "http://localhost/" });
  globalAny.window = bootWindow;
  globalAny.document = bootWindow.document;
  globalAny.HTMLElement = bootWindow.HTMLElement;
  globalAny.navigator = undefined;
}

function restoreDomGlobals(state: RegisteredGlobals): void {
  restoreOrDelete("window", state.windowPresent, state.windowValue);
  restoreOrDelete("document", state.documentPresent, state.documentValue);
  restoreOrDelete("HTMLElement", state.htmlElementPresent, state.htmlElementValue);
  restoreOrDelete("navigator", state.navigatorPresent, state.navigatorValue);
}

// DH-0135/DH-0147: Bun can overlap test files in one process, so toggling DOM globals per
// individual test races other web-component tests; but leaving them installed for the entire
// process makes unrelated Ink/TUI tests see a fake browser and crash inside Ink/yoga init.
// Each importing file registers a beforeAll/afterAll pair here; a process-wide refcount keeps
// the globals installed while any web test file is actively running, then restores the prior
// process globals once the last one finishes.
export function registerDomGlobals(): void {
  beforeAll(() => {
    const state = getRegisteredGlobals();
    if (state.refs === 0) installDomGlobals();
    state.refs += 1;
  });

  afterAll(() => {
    const state = getRegisteredGlobals();
    state.refs -= 1;
    if (state.refs === 0) restoreDomGlobals(state);
  });
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
