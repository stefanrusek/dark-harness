import "../test-dom.ts";

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { LogoMark } from "./LogoMark.tsx";

afterEach(cleanup);

describe("LogoMark", () => {
  test("renders an accessible DH monogram svg with both letterforms' geometry", () => {
    const { container } = render(<LogoMark />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-label")).toBe("DH — Dark Harness");
    expect(svg?.getAttribute("role")).toBe("img");

    const paths = Array.from(container.querySelectorAll("path")).map((p) => p.getAttribute("d"));
    // D: stem + bowl
    expect(paths).toContain("M46 64 L46 192");
    expect(paths).toContain("M46 64 H82 A44 64 0 0 1 82 192 H46");
    // H: two stems + crossbar
    expect(paths).toContain("M146 64 L146 192");
    expect(paths).toContain("M210 64 L210 192");
    expect(paths).toContain("M146 128 L210 128");
  });

  test("applies the className prop to the root svg", () => {
    const { container } = render(<LogoMark className="brand-mark" />);
    expect(container.querySelector("svg.brand-mark")).not.toBeNull();
  });
});
