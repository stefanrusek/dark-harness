import "../test-dom.ts";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { ErrorBanner } from "./ErrorBanner.tsx";

afterEach(cleanup);

describe("ErrorBanner", () => {
  test("hidden with no message", () => {
    const { container } = render(<ErrorBanner message={null} />);
    expect(container.querySelector(".error-banner")?.classList.contains("hidden")).toBe(true);
  });

  test("visible with a message", () => {
    const { container } = render(<ErrorBanner message="boom" />);
    const banner = container.querySelector(".error-banner");
    expect(banner?.classList.contains("hidden")).toBe(false);
    expect(banner?.textContent).toBe("boom");
    expect(banner?.getAttribute("role")).toBe("alert");
  });
});
