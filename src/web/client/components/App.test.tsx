import "../test-dom.ts";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import type { HeaderInfo } from "../../../header-info.ts";
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
        onCancelQueuedMessage={noop}
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

  test("DH-0248: the masthead lives in the fixed .app-header-slot, never inside .output-scroll", () => {
    const headerInfo: HeaderInfo = {
      name: "dh",
      logoFull: "[full logo]",
      logoCompact: "[ dh ]",
      build: { version: "0.1.0", gitSha: "abc123", dirty: false, releaseTag: null },
      config: { exists: true, path: "dh.json", modelCount: 2, hasToken: false, hasTls: false },
    };
    const { container } = render(
      <App
        state={createInitialState()}
        headerInfo={headerInfo}
        now={Date.now()}
        errorMessage={null}
        onSelectAgent={noop}
        onSendMessage={noop}
        onDownloadAgentLog={noop}
        onDownloadSessionBundle={noop}
        onStopAgent={noop}
        onCancelQueuedMessage={noop}
        onSelectModel={noop}
        onCloseModelPicker={noop}
        onDismissGapBanner={noop}
      />,
    );
    const masthead = container.querySelector(".app-header-slot .app-header");
    expect(masthead).not.toBeNull();
    expect(container.querySelector(".app-header-slot")?.contains(masthead)).toBe(true);
    // Structurally non-scrolling: the masthead must never be a descendant of the
    // transcript's own scroll region.
    const scrollRegion = container.querySelector(".output-scroll");
    expect(scrollRegion?.contains(masthead ?? null) ?? false).toBe(false);
  });
});
