import { registerDomGlobals } from "../test-dom.ts";
registerDomGlobals();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { GapBanner } from "./GapBanner.tsx";

afterEach(cleanup);

describe("GapBanner", () => {
  test("hidden and empty when not visible", () => {
    const { container } = render(<GapBanner visible={false} onDismiss={() => {}} />);
    const banner = container.querySelector(".gap-banner");
    expect(banner?.classList.contains("hidden")).toBe(true);
    expect(banner?.querySelector(".gap-banner-dismiss")).toBeNull();
  });

  test("shows the reconnected message and dismiss button when visible", () => {
    let dismissed = false;
    const { container } = render(
      <GapBanner
        visible={true}
        onDismiss={() => {
          dismissed = true;
        }}
      />,
    );
    const banner = container.querySelector(".gap-banner");
    expect(banner?.classList.contains("hidden")).toBe(false);
    expect(banner?.textContent).toContain("Reconnected");
    fireEvent.click(banner?.querySelector(".gap-banner-dismiss") as HTMLElement);
    expect(dismissed).toBe(true);
  });
});
