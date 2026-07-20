// DH-0165: proves bootstrap.ts's module-scope self-invoke actually calls boot() with the
// ambient `document`/`fetch` globals — the real bug this ticket fixed (main.ts's old
// `import.meta.main`-guarded self-invoke was silently dead-code-eliminated by Bun's browser
// HTML-import bundler, so `boot()` never ran in any real browser) was invisible to
// main.test.ts, which only ever called `boot()` directly and never exercised the entry
// file's own module-scope invocation. Swaps in a fake `document`/`fetch` on the globals
// bootstrap.ts reads from, then dynamically imports it so the self-invoke runs against those
// fakes instead of a real network call.
import { afterEach, describe, expect, test } from "bun:test";
import type { HeaderInfo } from "../../header-info.ts";
import type { WebConfigResponse } from "../protocol.ts";
// Import order matters here: "./main.ts" (transitively "./app.ts") is what first loads
// `react-dom/client` in this process, whose own module-scope devtools-detection code reads
// the ambient `navigator` global — it must run while that's still Bun's real `navigator`,
// before "./test-dom.ts" below overrides it to `undefined` (deliberately, so the Anthropic
// SDK's `isRunningInBrowser()` check stays false in tests — see that file's own comment).
// Every other *.test.ts(x) in this directory gets this ordering "for free" because it
// imports the component under test (which pulls in react-dom) before test-dom.ts; this file
// only reaches app.ts indirectly through a *dynamic* `import("./bootstrap.ts")` inside the
// test body, well after test-dom.ts's static import already ran — so it needs this explicit
// warm-up import to get the same ordering.
import "./main.ts";
import { createTestDom } from "./test-dom.ts";

describe("bootstrap", () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.document = originalDocument;
  });

  test("module-scope self-invoke wires a real AppView into #root using ambient globals", async () => {
    const { document, root } = createTestDom();
    root.id = "root";
    globalThis.document = document;

    const headerInfo: HeaderInfo = {
      name: "dh",
      logoFull: "dh",
      logoCompact: "dh",
      build: { version: "0.0.0", gitSha: null, dirty: false, releaseTag: null },
      config: { exists: true, path: "dh.json", modelCount: 1, hasToken: false, hasTls: false },
    };
    const config: WebConfigResponse = { baseUrl: "http://x", headerInfo };
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify(config), { status: 200 }),
      )) as unknown as typeof fetch;

    await import("./bootstrap.ts");
    // boot()'s config fetch + react-dom's render are both scheduled, not synchronous.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(root.childNodes.length).toBeGreaterThan(0);
  });
});
