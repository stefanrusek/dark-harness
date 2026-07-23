// DH-0122/DH-0248: `<AppHeader>` renders the masthead (brand + build + config-instrument
// chips) once `headerInfo` is supplied (fetched from `WEB_CONFIG_PATH` at boot — see
// main.ts). Global DOM registration is `test-dom.ts`'s side effect — see its module-level
// comment.
import "../test-dom.ts";

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { cleanup, render } from "@testing-library/react";
import type { HeaderInfo } from "../../../header-info.ts";
import { AppHeader } from "./AppHeader.tsx";

afterEach(cleanup);

const HEADER_INFO: HeaderInfo = {
  name: "dh",
  logoFull: "[full logo]",
  logoCompact: "[ dh ]",
  build: { version: "0.1.0", gitSha: "abc123", dirty: false, releaseTag: null },
  config: {
    exists: true,
    path: "dh.json",
    modelCount: 2,
    hostname: "0.0.0.0",
    hasToken: false,
    hasTls: false,
  },
};

describe("AppHeader", () => {
  test("mounts and renders no visible DOM when headerInfo is undefined (pre-boot)", () => {
    const { container } = render(<AppHeader />);
    expect(container.innerHTML).toBe("");
    expect(container.children.length).toBe(0);
  });

  test("renders the LogoMark SVG and the 'Dark Harness' wordmark", () => {
    const { container, getByText } = render(<AppHeader headerInfo={HEADER_INFO} />);
    expect(container.querySelector(".app-header svg")).toBeTruthy();
    expect(getByText("Dark Harness")).toBeTruthy();
  });

  test("wordmark carries the shared brand gradient sourced from the CSS custom properties", () => {
    const { getByText } = render(<AppHeader headerInfo={HEADER_INFO} />);
    const wordmark = getByText("Dark Harness");
    // The gradient fill itself is declared in styles.css's `.app-header-wordmark` rule
    // against `--brand-grad-start`/`--brand-grad-end` (asserted directly against the
    // stylesheet source below); this pins the class hook the CSS rule targets.
    expect(wordmark.className).toContain("app-header-wordmark");

    const css = readFileSync(new URL("../styles.css", import.meta.url).pathname, "utf8");
    expect(css).toContain("--brand-grad-start: #9ece6a;");
    expect(css).toContain("--brand-grad-end: #7dcfff;");
    expect(css).toMatch(
      /\.app-header-wordmark\s*\{[^}]*background:\s*linear-gradient\(90deg,\s*var\(--brand-grad-start\),\s*var\(--brand-grad-end\)\)/,
    );
    // Solid `color: var(--text)` fallback declared before the gradient clip, per the
    // ticket's legibility requirement (unsupported contexts must still show readable text).
    expect(css).toMatch(/\.app-header-wordmark\s*\{[^}]*color:\s*var\(--text\)/);
  });

  test("the wordmark entrance animation is gated behind prefers-reduced-motion: no-preference", () => {
    const css = readFileSync(new URL("../styles.css", import.meta.url).pathname, "utf8");
    const noPreferenceBlockMatch = css.match(
      /@media \(prefers-reduced-motion: no-preference\)\s*\{([\s\S]*?)\n\}/,
    );
    expect(noPreferenceBlockMatch).not.toBeNull();
    const noPreferenceBlock = noPreferenceBlockMatch?.[1] ?? "";
    // The animation is only declared inside the no-preference media block, so it never runs
    // under `prefers-reduced-motion: reduce` (no unconditional `.app-header-wordmark`
    // animation rule exists outside this block).
    expect(noPreferenceBlock).toMatch(/\.app-header-wordmark\s*\{[^}]*animation:/);
    const outsideMediaBlocks = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\}[^{}]*)*\}/g, "");
    expect(outsideMediaBlocks).not.toMatch(/\.app-header-wordmark\s*\{[^}]*animation:/);
  });

  test("renders the version/build identity", () => {
    const { getByText } = render(<AppHeader headerInfo={HEADER_INFO} />);
    expect(getByText("dh 0.1.0 (abc123)")).toBeTruthy();
  });

  test("config chip row carries every fact formatConfigStatusLine renders: path, model count, bind host, tls", () => {
    const { getByText } = render(
      <AppHeader
        headerInfo={{
          ...HEADER_INFO,
          config: { ...HEADER_INFO.config, hasToken: true, hasTls: true },
        }}
      />,
    );
    expect(getByText("config dh.json · 2 models", { exact: false })).toBeTruthy();
    expect(getByText("bind 0.0.0.0")).toBeTruthy();
    expect(getByText("token required")).toBeTruthy();
    expect(getByText("tls on")).toBeTruthy();
  });

  test("bind chip falls back to 'all interfaces' when no hostname is configured", () => {
    const { getByText } = render(
      <AppHeader
        headerInfo={{
          ...HEADER_INFO,
          config: { exists: true, path: "dh.json", modelCount: 1, hasToken: true, hasTls: false },
        }}
      />,
    );
    expect(getByText("bind all interfaces")).toBeTruthy();
  });

  test("auth chip shows the warning-accent '⚠ no token' glyph+class when hasToken is false", () => {
    const { getByText } = render(<AppHeader headerInfo={HEADER_INFO} />);
    const chip = getByText("⚠ no token");
    expect(chip.className).toContain("header-chip-warn");
  });

  test("auth chip shows a neutral 'token required' chip with no warning class when hasToken is true", () => {
    const { getByText, queryByText } = render(
      <AppHeader
        headerInfo={{
          ...HEADER_INFO,
          config: { ...HEADER_INFO.config, hasToken: true },
        }}
      />,
    );
    const chip = getByText("token required");
    expect(chip.className).not.toContain("header-chip-warn");
    expect(queryByText("⚠ no token")).toBeNull();
  });

  test("tls chip is only rendered when hasTls is true", () => {
    const { queryByText } = render(<AppHeader headerInfo={HEADER_INFO} />);
    expect(queryByText("tls on")).toBeNull();
  });

  test("renders a 'config not found' chip when config.exists is false", () => {
    const { getByText } = render(
      <AppHeader
        headerInfo={{
          ...HEADER_INFO,
          config: { exists: false, path: "dh.json", modelCount: 0, hasToken: false, hasTls: false },
        }}
      />,
    );
    expect(getByText("config: not found (dh.json)")).toBeTruthy();
  });

  test("the masthead's config chip row is present, proving no information regression vs. formatConfigStatusLine", () => {
    // formatConfigStatusLine's old one-liner rendered: path, model count, bind host, token
    // state, tls state — assert all five facts are present in the DOM for a fully-populated
    // summary (structural regression guard, not a pixel test).
    const { getByText } = render(
      <AppHeader
        headerInfo={{
          ...HEADER_INFO,
          config: {
            exists: true,
            path: "dh.json",
            modelCount: 3,
            hostname: "127.0.0.1",
            hasToken: true,
            hasTls: true,
          },
        }}
      />,
    );
    expect(getByText("config dh.json · 3 models")).toBeTruthy();
    expect(getByText("bind 127.0.0.1")).toBeTruthy();
    expect(getByText("token required")).toBeTruthy();
    expect(getByText("tls on")).toBeTruthy();
  });
});
