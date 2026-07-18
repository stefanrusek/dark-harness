import { registerDomGlobals } from "../test-dom.ts";
registerDomGlobals();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { createInitialState } from "../state.ts";
import { App } from "./App.tsx";

afterEach(cleanup);

function noop() {}

describe("App", () => {
  test("composes the app-header slot, sidebar, main pane and model picker", () => {
    const { container } = render(
      <App
        state={createInitialState()}
        now={Date.now()}
        errorMessage={null}
        onSelectAgent={noop}
        onSendMessage={noop}
        onDownloadAgentLog={noop}
        onDownloadSessionBundle={noop}
        onStopAgent={noop}
        onSelectModel={noop}
        onCloseModelPicker={noop}
        onDismissGapBanner={noop}
      />,
    );
    expect(container.querySelector(".dh-app")).not.toBeNull();
    expect(container.querySelector(".app-header-slot")).not.toBeNull();
    expect(container.querySelector(".sidebar")).not.toBeNull();
    expect(container.querySelector(".main-pane")).not.toBeNull();
    expect(container.querySelector(".model-picker-overlay")).not.toBeNull();
    // DH-0135 story 2: the reserved <AppHeader> slot renders no visible DOM until DH-0122.
    expect(container.querySelector(".app-header-slot")?.childElementCount).toBe(0);
  });
});
