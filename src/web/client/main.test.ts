// Unit-tests `boot()`, the thin real-browser bootstrap (see main.ts's own comment for why
// the module-scope `import.meta.main` guard exists). This proves the wiring — #root lookup,
// config fetch, `AppView` construction/start — without depending on a real browser; deeper
// behavior (rendering, SSE handling, commands) is already covered by app.test.ts and friends.
import { describe, expect, test } from "bun:test";
import type { HeaderInfo } from "../../header-info.ts";
import type { WebConfigResponse } from "../protocol.ts";
import { boot } from "./main.ts";
import { createTestDom } from "./test-dom.ts";

function fakeFetch(config: WebConfigResponse): typeof fetch {
  return (() =>
    Promise.resolve(
      new Response(JSON.stringify(config), { status: 200 }),
    )) as unknown as typeof fetch;
}

describe("boot", () => {
  test("throws when #root is missing", async () => {
    const { document } = createTestDom();
    await expect(boot(document, fakeFetch({ baseUrl: "http://x" }))).rejects.toThrow(
      "#root element not found",
    );
  });

  test("fetches config and wires an AppView into #root", async () => {
    const { document, root } = createTestDom();
    root.id = "root";
    const headerInfo: HeaderInfo = {
      name: "dh",
      logoFull: "dh",
      logoCompact: "dh",
      build: { version: "0.0.0", gitSha: null, dirty: false, releaseTag: null },
      config: { exists: true, path: "dh.json", modelCount: 1, hasToken: false, hasTls: false },
    };
    await boot(document, fakeFetch({ baseUrl: "http://x", token: "tok", headerInfo }));
    // react-dom's root render is scheduled, not synchronous — give it a tick to flush.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.childNodes.length).toBeGreaterThan(0);
  });
});
