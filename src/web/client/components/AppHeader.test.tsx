// DH-0122: `<AppHeader>` renders the app name/version/config-status summary once
// `headerInfo` is supplied (fetched from `WEB_CONFIG_PATH` at boot — see main.ts). Global DOM
// registration is `test-dom.ts`'s side effect — see its module-level comment.
import { registerDomGlobals } from "../test-dom.ts";
registerDomGlobals();

import { afterEach, describe, expect, test } from "bun:test";
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

  test("renders the compact logo, version/build identity, and config status once headerInfo lands", () => {
    const { getByText } = render(<AppHeader headerInfo={HEADER_INFO} />);
    expect(getByText("[ dh ]")).toBeTruthy();
    expect(getByText("dh 0.1.0 (abc123)")).toBeTruthy();
    expect(getByText("config: dh.json — 2 models, bind all interfaces, no token")).toBeTruthy();
  });
});
