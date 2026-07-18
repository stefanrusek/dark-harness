import { registerDomGlobals } from "../test-dom.ts";
registerDomGlobals();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { ConnectionPill } from "./ConnectionPill.tsx";

afterEach(cleanup);

describe("ConnectionPill", () => {
  test.each([
    ["connecting", "Connecting…"],
    ["live", "Live"],
    ["reconnecting", "Reconnecting…"],
    ["disconnected", "Disconnected"],
  ] as const)("renders %s as %s", (status, label) => {
    const { container } = render(<ConnectionPill status={status} />);
    expect(container.textContent).toBe(label);
    expect(container.querySelector(`.connection-${status}`)).not.toBeNull();
  });
});
