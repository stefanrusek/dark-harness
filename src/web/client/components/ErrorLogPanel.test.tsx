import "../test-dom.ts";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { createInitialState, logError } from "../state.ts";
import { ErrorLogPanel } from "./ErrorLogPanel.tsx";

afterEach(cleanup);

describe("ErrorLogPanel", () => {
  test("hidden when the log is empty", () => {
    const { container } = render(<ErrorLogPanel state={createInitialState()} />);
    expect(container.querySelector(".error-log-panel")?.classList.contains("hidden")).toBe(true);
  });

  test("lists entries newest-first once errors are logged", () => {
    let state = createInitialState();
    state = logError(state, "first", "2026-01-01T00:00:00Z");
    state = logError(state, "second", "2026-01-01T00:00:01Z");
    const { container } = render(<ErrorLogPanel state={state} />);
    const panel = container.querySelector(".error-log-panel");
    expect(panel?.classList.contains("hidden")).toBe(false);
    const messages = [...container.querySelectorAll(".error-log-message")].map(
      (n) => n.textContent,
    );
    expect(messages).toEqual(["second", "first"]);
  });
});
