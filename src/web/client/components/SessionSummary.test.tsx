import { registerDomGlobals } from "../test-dom.ts";
registerDomGlobals();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { createInitialState } from "../state.ts";
import { SessionSummary } from "./SessionSummary.tsx";

afterEach(cleanup);

describe("SessionSummary", () => {
  test("renders zeroed totals with no end-of-session banner", () => {
    const { container } = render(<SessionSummary state={createInitialState()} />);
    expect(container.querySelector(".session-stats")).not.toBeNull();
    expect(container.querySelector(".session-banner")).toBeNull();
  });

  test("renders the end-of-session banner once the session ends", () => {
    const state = { ...createInitialState(), sessionEnded: true, exitCode: 0 };
    const { container } = render(<SessionSummary state={state} />);
    const banner = container.querySelector(".session-banner");
    expect(banner).not.toBeNull();
    expect(banner?.classList.contains("session-banner-ok")).toBe(true);
    expect(banner?.textContent).toContain("success (exit 0)");
  });

  test("renders the failure banner style for a nonzero exit code", () => {
    const state = { ...createInitialState(), sessionEnded: true, exitCode: 1 };
    const { container } = render(<SessionSummary state={state} />);
    expect(container.querySelector(".session-banner-fail")).not.toBeNull();
  });
});
