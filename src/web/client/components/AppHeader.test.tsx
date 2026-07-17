// DH-0135: `<AppHeader>` is a reserved slot for DH-0122 — it must mount cleanly and render
// nothing (no visible DOM, no layout shift) until that ticket fills it in. Global DOM
// registration is `test-dom.ts`'s side effect — see its module-level comment.
import "../test-dom.ts";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { AppHeader } from "./AppHeader.tsx";

afterEach(cleanup);

describe("AppHeader", () => {
  test("mounts and renders no visible DOM, with no defaults supplied", () => {
    const { container } = render(<AppHeader />);
    expect(container.innerHTML).toBe("");
    expect(container.children.length).toBe(0);
  });

  test("still renders nothing once agentState/dhConfig are supplied (DH-0122's future props)", () => {
    const { container } = render(
      <AppHeader agentState={{ some: "state" }} dhConfig={{ some: "config" }} />,
    );
    expect(container.innerHTML).toBe("");
    expect(container.children.length).toBe(0);
  });
});
